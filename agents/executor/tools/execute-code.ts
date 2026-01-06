import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import Docker from "dockerode";
import { mkdir, writeFile, readdir, access, constants } from "fs/promises";
import { join } from "path";
import { Readable } from "stream";

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
		const docker = new Docker();
		let container: Docker.Container | undefined;
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
			const containerName = `manim-${executionId}`;
			console.log("Creating container with name:", containerName);
			
			// Create container using dockerode
			container = await docker.createContainer({
				Image: "manimcommunity/manim:stable",
				name: containerName,
				Cmd: [
					"manim",
					"-qh", // preview, quality low, and leave files
					"--disable_caching",
					"--flush_cache",
					codeFileName,
					sceneClassName,
				],
				HostConfig: {
					Binds: [`${workDir}:/manim`],
					AutoRemove: false, // We'll remove manually
				},
				WorkingDir: "/manim",
			});

			containerId = container.id;
			console.log("Container created successfully:", containerId);

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
			await container.start();
			console.log("Container started successfully:", containerId);

			// Wait for container to finish
			const waitResponse = await container.wait();
			const exitCode = waitResponse.StatusCode || 0;
			console.log("Container finished with exit code:", exitCode);

			// Get logs - dockerode can return a Buffer or stream
			const logsResult = container.logs({
				stdout: true,
				stderr: true,
				follow: false,
			});

			let logOutput: string;
			
			// Check if it's a Promise (resolves to Buffer) or a stream
			if (logsResult instanceof Promise) {
				const logBuffer = await logsResult;
				logOutput = logBuffer.toString("utf-8");
			} else {
				// It's a stream
				const logChunks: Buffer[] = [];
				await new Promise<void>((resolve, reject) => {
					(logsResult as Readable).on("data", (chunk: Buffer) => {
						logChunks.push(chunk);
					});
					(logsResult as Readable).on("end", () => {
						resolve();
					});
					(logsResult as Readable).on("error", (err: Error) => {
						reject(err);
					});
				});
				logOutput = Buffer.concat(logChunks).toString("utf-8");
			}

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

			// Generate the video URL path
			const videoFileName = videoPath.split("/").pop() || "output.mp4";
			const videoUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/videos/${executionId}/${videoFileName}`;

			// Send video URL via SSE
			if (sseStream) {
				sseStream.writeSSE({
					event: "video-url",
					data: JSON.stringify({
						url: videoUrl,
						toolCallId: config.toolCall.id,
					}),
				});
			}

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

			// Return only the video URL path
			return new ToolMessage({
				content: videoUrl,
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
						content: `Manim code execution failed`,
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
			if (container) {
				try {
					// Stop the container
					await container.stop().catch(() => {
						// Container might already be stopped
					});
					// Remove the container
					await container.remove({ force: true });
				} catch (cleanupError) {
					console.error("Error cleaning up container:", cleanupError);
				}
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
