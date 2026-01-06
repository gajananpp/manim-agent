"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { ThreadContent } from "@/components/assistant-ui/thread";
import { ManimCodeDisplay } from "@/components/manim-code-display";
import { ManimVideoDisplay } from "@/components/manim-video-display";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { z } from "zod";

// Zod schemas for SSE event data
const videoUrlEventSchema = z.object({
  url: z.string().refine(
    (val) => {
      try {
        new URL(val);
        return true;
      } catch {
        return val.startsWith("/");
      }
    },
    { message: "URL must be a valid URL or start with /" }
  ),
  toolCallId: z.string().optional(),
});

const codeEventSchema = z.object({
  code: z.string(),
  toolCallId: z.string().optional(),
});

// Payload for `event: notification` (note: this event uses the SSE event name, not a `type` field)
const notificationPayloadSchema = z.object({
  content: z.string().optional(),
  id: z.string().optional(),
  status: z.string().optional(),
});

const textDeltaEventSchema = z.object({
  type: z.literal("text-delta"),
  content: z.string(),
});

const toolCallArgDeltaEventSchema = z.object({
  type: z.literal("tool-call-arg-delta"),
  toolCallId: z.string(),
  toolName: z.string(),
  argName: z.string(),
  value: z.string(),
});

const messageEventSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["assistant", "tool"]),
  content: z.string().optional(),
  toolCalls: z.array(z.any()).optional(),
  toolCallId: z.string().optional(),
});

const toolCallArgsSchema = z.object({
  code: z.string(),
});

const doneEventSchema = z.object({
  type: z.literal("done"),
  message: z.string().optional(),
});

const errorEventSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
});

// Global state to track streaming code for the code display component
let streamingCode: string = "";
const streamingCodeCallbacks: Set<(code: string) => void> = new Set();

// Global state to track video URL
let videoUrl: string | null = null;
const videoUrlCallbacks: Set<(url: string | null) => void> = new Set();

export const subscribeToCodeStream = (callback: (code: string) => void) => {
  streamingCodeCallbacks.add(callback);
  return () => {
    streamingCodeCallbacks.delete(callback);
  };
};

export const getStreamingCode = () => streamingCode;

export const subscribeToVideoUrl = (callback: (url: string | null) => void) => {
  videoUrlCallbacks.add(callback);
  return () => {
    videoUrlCallbacks.delete(callback);
  };
};

export const getVideoUrl = () => videoUrl;

const MyModelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // Convert messages to the format expected by the API
    const apiMessages = messages.map((msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return {
        role: msg.role,
        content,
      };
    });

    // Accumulate tool call args for streaming code extraction
    const accumulatedToolCallArgs: Map<string, string> = new Map();

    // Reset streaming code, video URL, and accumulated args
    streamingCode = "";
    videoUrl = null;
    accumulatedToolCallArgs.clear();
    streamingCodeCallbacks.forEach((cb) => cb(""));
    videoUrlCallbacks.forEach((cb) => cb(null));

    // Connect to the API route
    const response = await fetch("/api/v1/messages?agent=manim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: apiMessages }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    // Read the SSE stream
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("No response body");
    }

    let buffer = "";
    let currentText = "";
    let messageStarted = false;
    let currentToolCalls: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }> = [];
    let currentEvent: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        // Track event name
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        
        // Empty line resets event tracking (SSE format: event + data + empty line)
        if (line.trim() === "") {
          currentEvent = undefined;
          continue;
        }
        
        if (line.startsWith("data: ")) {
          try {
            const rawData = JSON.parse(line.slice(6));
            
            // Handle `notification` event (shiny "Thinking"-style status in the thread)
            if (currentEvent === "notification") {
              const notif = notificationPayloadSchema.safeParse(rawData);
              if (notif.success) {
                const content = (notif.data.content || "").trim();
                if (content.length > 0) {
                  // Show notifications as shiny text, even if assistant has started
                  // They'll appear as temporary status messages
                  yield {
                    content: [
                      {
                        type: "text",
                        text: `[[shiny]]${content}`,
                      },
                    ],
                  };
                }
              } else {
                console.warn("Invalid notification event data:", notif.error);
              }
              continue;
            }

            // Handle `code` event (server emits best-effort parsed code from tool args stream)
            if (currentEvent === "code") {
              const codeResult = codeEventSchema.safeParse(rawData);
              if (codeResult.success) {
                streamingCode = codeResult.data.code;
                streamingCodeCallbacks.forEach((cb) => cb(codeResult.data.code));
              } else {
                console.warn("Invalid code event data:", codeResult.error);
              }
              continue;
            }

            // Handle video-url event (from SSE event name)
            if (currentEvent === "video-url") {
              const videoUrlResult = videoUrlEventSchema.safeParse(rawData);
              if (videoUrlResult.success) {
                videoUrl = videoUrlResult.data.url;
                videoUrlCallbacks.forEach((cb) => cb(videoUrlResult.data.url));
              } else {
                console.warn("Invalid video-url event data:", videoUrlResult.error);
              }
              continue;
            }
            
            // Handle text deltas - accumulate and yield full text
            const textDeltaResult = textDeltaEventSchema.safeParse(rawData);
            if (textDeltaResult.success) {
              const data = textDeltaResult.data;
              // Accumulate the text
              currentText += data.content;
              // Yield the FULL accumulated text each time
              // Assistant-ui should update the current message with this content
              yield {
                content: [
                  {
                    type: "text",
                    text: currentText, // Always yield the full accumulated text
                  },
                ],
              };
              messageStarted = true;
              // Once real assistant text starts, stop showing notifications
            }

            // Handle tool call arg deltas (for streaming code)
            const toolCallArgDeltaResult = toolCallArgDeltaEventSchema.safeParse(rawData);
            if (toolCallArgDeltaResult.success && toolCallArgDeltaResult.data.toolName === "execute_code" && toolCallArgDeltaResult.data.argName === "code") {
              try {
                const data = toolCallArgDeltaResult.data;
                const toolCallId = data.toolCallId;
                const argsChunk = data.value;
                
                // Accumulate the args chunks for this tool call
                const currentAccumulated = accumulatedToolCallArgs.get(toolCallId) || "";
                const newAccumulated = currentAccumulated + argsChunk;
                accumulatedToolCallArgs.set(toolCallId, newAccumulated);
                
                // Try to parse the accumulated JSON using Zod
                try {
                  // The args should be a JSON string like: {"code": "..."}
                  const parsed = JSON.parse(newAccumulated);
                  const toolCallArgsResult = toolCallArgsSchema.safeParse(parsed);
                  if (toolCallArgsResult.success) {
                    streamingCode = toolCallArgsResult.data.code;
                    streamingCodeCallbacks.forEach((cb) => cb(toolCallArgsResult.data.code));
                  }
                } catch {
                  // JSON is incomplete, try to extract code using regex as fallback
                  // Look for "code": "..." pattern (handling partial JSON)
                  const codeMatch = newAccumulated.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
                  if (codeMatch && codeMatch[1]) {
                    // Decode escaped characters
                    const code = codeMatch[1]
                      .replace(/\\n/g, "\n")
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, "\\")
                      .replace(/\\t/g, "\t")
                      .replace(/\\r/g, "\r");
                    
                    if (code.length > 0) {
                      streamingCode = code;
                      streamingCodeCallbacks.forEach((cb) => cb(code));
                    }
                  } else {
                    // Try partial match for incomplete JSON
                    const partialMatch = newAccumulated.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)/);
                    if (partialMatch && partialMatch[1]) {
                      const partialCode = partialMatch[1]
                        .replace(/\\n/g, "\n")
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, "\\")
                        .replace(/\\t/g, "\t")
                        .replace(/\\r/g, "\r");
                      
                      if (partialCode.length > 0) {
                        streamingCode = partialCode;
                        streamingCodeCallbacks.forEach((cb) => cb(partialCode));
                      }
                    }
                  }
                }
              } catch (error) {
                // Ignore errors for partial JSON
                console.warn("Error processing tool-call-arg-delta:", error);
              }
            }

            // Handle complete messages
            const messageResult = messageEventSchema.safeParse(rawData);
            if (messageResult.success) {
              const data = messageResult.data;
              if (data.role === "assistant") {
                // Only update currentText if we haven't been accumulating via deltas
                // If we have accumulated text from deltas, keep it; otherwise use the message content
                if (data.content && !messageStarted) {
                  currentText = data.content;
                }
                // If we already have accumulated text, append any additional content
                else if (data.content && messageStarted && data.content !== currentText) {
                  // Only append if it's different (might be a complete message after streaming)
                  if (data.content.length > currentText.length) {
                    currentText = data.content;
                  }
                }
                currentToolCalls = data.toolCalls || [];
                
                // Yield the complete message with accumulated text
                yield {
                  content: [
                    {
                      type: "text",
                      text: currentText,
                    },
                  ],
                  toolCalls: currentToolCalls.map((tc) => ({
                    toolCallId: tc.id || "",
                    toolName: tc.name || "",
                    args: tc.args || {},
                  })),
                };
                messageStarted = true;
              } else if (data.role === "tool") {
                // Yield tool messages so they're available in the message history
                // This allows components like ManimVideoDisplay to extract video URLs
                yield {
                  content: [
                    {
                      type: "text",
                      text: data.content || "",
                    },
                  ],
                  toolCallId: data.toolCallId,
                };
              }
            }


            // Handle completion
            const doneResult = doneEventSchema.safeParse(rawData);
            if (doneResult.success) {
              // Finalize any pending content - ensure we yield the final accumulated text
              if (currentText && messageStarted) {
                yield {
                  content: [
                    {
                      type: "text",
                      text: currentText,
                    },
                  ],
                };
              }
              // Clear any lingering notification once the stream completes
            }

            // Handle errors
            const errorResult = errorEventSchema.safeParse(rawData);
            if (errorResult.success) {
              throw new Error(errorResult.data.error || "Unknown error");
            }
          } catch (e) {
            // Ignore JSON parse errors for incomplete data
            console.warn("Failed to parse SSE data:", line, e);
          }
        }
      }
    }
  },
};

export function ThreadWrapper() {
  const runtime = useLocalRuntime(MyModelAdapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root
        className="h-full w-full aui-root aui-thread-root @container"
        style={{
          ["--thread-max-width" as string]: "44rem",
        }}
      >
      <div className="flex h-full w-full overflow-hidden bg-linear-to-br from-background via-background to-muted/20">
        {/* Left Column: Assistant UI Thread */}
        <div className="w-[55%] h-full border-r border-border/50 overflow-hidden bg-background/95 backdrop-blur-sm flex flex-col">
          {/* Header */}
          <div className="shrink-0 border-b border-border/50 bg-muted/30 px-4 py-3 flex items-center justify-between h-[52px]">
            <h1 className="text-lg font-semibold text-foreground">Manim Agent</h1>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                // Update with your GitHub repository URL
                window.open("https://github.com/gajananpp/manim-agent", "_blank");
              }}
            >
              <Star className="h-4 w-4" />
              <span>Star on GitHub</span>
            </Button>
          </div>
          {/* Thread Content */}
          <div className="flex-1 overflow-hidden min-h-0">
            <ThreadContent />
          </div>
        </div>

        {/* Right Column: Code and Video */}
        <div className="flex-1 h-full flex flex-col min-w-0">
          {/* Top Row: Python Code */}
          <div className="h-1/2 border-b border-border/50 overflow-hidden min-w-0">
            <ManimCodeDisplay />
          </div>

          {/* Bottom Row: Manim Video */}
          <div className="h-1/2 overflow-hidden min-w-0">
            <ManimVideoDisplay />
          </div>
        </div>
      </div>
    </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

