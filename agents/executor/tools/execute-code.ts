import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DockerClient } from "@docker/node-sdk";
import { mkdir, writeFile, readdir, access, constants } from "fs/promises";
import { join } from "path";
import { Writable } from "stream";

const toolInputSchema = z.object({
	code: z.string().describe("The Manim Python code to execute"),
});

interface SSEStream {
	writeSSE: (data: { event: string; data: string }) => void;
}

interface Configurable {
	sseStream?: SSEStream;
}

export const executeCodeTool = tool(
	async (input, config) => {
		const { code } = input as { code: string };
		const docker = await DockerClient.fromDockerConfig();
		let containerId: string | undefined;
		let workDir: string | undefined;

		try {
			if (!config.toolCall?.id) {
				throw new Error("Tool call not found");
			}

			// Get configurable from config if available
			const { sseStream } = (config.configurable as Configurable) || {};

			// Notify start
			if (sseStream) {
				sseStream.writeSSE({
					event: "notification",
					data: JSON.stringify({
						content: "Starting Manim code execution",
						id: Bun.randomUUIDv7(),
						status: "started",
					}),
				});
			}

			// Create a temporary directory for this execution
			const executionId = Bun.randomUUIDv7();
			workDir = join(process.cwd(), "tmp", "manim-executions", executionId);
			await mkdir(workDir, { recursive: true });

			// Write the Python code to a file
			const codeFileName = "scene.py";
			const codeFilePath = join(workDir, codeFileName);
			await writeFile(codeFilePath, code, "utf-8");

			// Determine the scene class name from the code
			// Extract class name from code (simple regex match)
			const classMatch = code.match(/class\s+(\w+)\s*\(/);
			const sceneClassName = classMatch ? classMatch[1] : "Scene";

			// Create Docker container with Manim
			// Using manimcommunity/manim image which has Manim pre-installed
			const containerResponse = await docker.containerCreate({
				Image: "manimcommunity/manim:stable",
				Cmd: [
					"manim",
					"-pql", // preview, quality low, and leave files
					codeFileName,
					sceneClassName,
				],
				HostConfig: {
					Binds: [`${workDir}:/manim`],
					AutoRemove: false, // We'll remove manually
				},
				WorkingDir: "/manim",
			});

			containerId = containerResponse.Id;

			// Notify container started
			if (sseStream) {
				sseStream.writeSSE({
					event: "notification",
					data: JSON.stringify({
						content: "Executing Manim code in Docker container",
						id: Bun.randomUUIDv7(),
						status: "running",
					}),
				});
			}

			// Start the container
			await docker.containerStart(containerId);

			// Wait for container to finish
			const waitResponse = await docker.containerWait(containerId);
			const exitCode = waitResponse.StatusCode || 0;

			// Get logs - containerLogs requires writable streams
			// Use promise-based approach with async writable streams
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];

			const stdoutStream = new Writable({
				async write(chunk) {
					stdoutChunks.push(Buffer.from(chunk));
				},
			});

			const stderrStream = new Writable({
				async write(chunk) {
					stderrChunks.push(Buffer.from(chunk));
				},
			});

			await docker.containerLogs(containerId, stdoutStream, stderrStream, {
				stdout: true,
				stderr: true,
			});

			const logOutput = Buffer.concat([...stdoutChunks, ...stderrChunks]).toString(
				"utf-8",
			);

			if (exitCode !== 0) {
				throw new Error(
					`Manim execution failed with exit code ${exitCode}. Logs: ${logOutput}`,
				);
			}

			// Find the generated video file
			// Manim outputs videos to media/videos/scene_name/quality/ directory
			const mediaDir = join(workDir, "media", "videos");
			let videoPath: string | undefined;

			// Check if directory exists using promise-based API
			try {
				await access(mediaDir, constants.F_OK);
				// Find the video file recursively
				const findVideoFile = async (dir: string): Promise<string | null> => {
					const entries = await readdir(dir, { withFileTypes: true });
					for (const entry of entries) {
						const fullPath = join(dir, entry.name);
						if (entry.isDirectory()) {
							const found = await findVideoFile(fullPath);
							if (found) return found;
						} else if (entry.isFile() && entry.name.endsWith(".mp4")) {
							return fullPath;
						}
					}
					return null;
				};

				videoPath = (await findVideoFile(mediaDir)) || undefined;
			} catch {
				// Directory doesn't exist, videoPath will remain undefined
			}

			if (!videoPath) {
				throw new Error(
					`Video file not found after execution. Logs: ${logOutput}`,
				);
			}

			// For now, return the local file path
			// In production, you'd want to upload this to a CDN/storage service
			// and return a public URL
			const videoFileName = videoPath.split("/").pop() || "output.mp4";
			const videoUrl = `/api/videos/${executionId}/${videoFileName}`;

			// Notify completion
			if (sseStream) {
				sseStream.writeSSE({
					event: "notification",
					data: JSON.stringify({
						content: "Manim code execution completed",
						id: Bun.randomUUIDv7(),
						status: "completed",
					}),
				});
			}

			return new ToolMessage({
				content: `Manim code executed successfully. Video URL: ${videoUrl}\n\nLogs:\n${logOutput}`,
				tool_call_id: config.toolCall.id,
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// Notify failure
			const { sseStream } = (config.configurable as Configurable) || {};
			if (sseStream) {
				sseStream.writeSSE({
					event: "notification",
					data: JSON.stringify({
						content: `Manim code execution failed: ${errorMessage}`,
						id: Bun.randomUUIDv7(),
						status: "failed",
					}),
				});
			}

			return new ToolMessage({
				content: `Error executing Manim code: ${errorMessage}\n\nPlease review the code and fix any issues.`,
				tool_call_id: config.toolCall?.id || "",
			});
		} finally {
			// Clean up: stop and remove container
			if (containerId) {
				try {
					// Stop the container
					await docker.containerStop(containerId).catch(() => {
						// Container might already be stopped
					});
					// Remove the container
					await docker.containerDelete(containerId, { force: true });
				} catch (cleanupError) {
					console.error("Error cleaning up container:", cleanupError);
				}
			}

			// Close Docker client connection
			try {
				await docker.close();
			} catch (closeError) {
				console.error("Error closing Docker client:", closeError);
			}

			// Clean up: remove temporary directory (optional - you might want to keep it for debugging)
			// Uncomment if you want to delete the work directory after execution
			// if (workDir) {
			//   try {
			//     await access(workDir, constants.F_OK);
			//     await rm(workDir, { recursive: true, force: true });
			//   } catch (cleanupError) {
			//     // Directory might not exist or already deleted
			//     console.error("Error cleaning up work directory:", cleanupError);
			//   }
			// }
		}
	},
	{
		name: "execute_code",
		description:
			"Executes Manim Python code in a Docker container. Takes the Python code as input, executes it, and returns the URL of the generated video.",
		schema: toolInputSchema,
	},
);
