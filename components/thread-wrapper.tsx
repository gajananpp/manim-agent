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

// Global state to track streaming code for the code display component
let streamingCode: string = "";
const streamingCodeCallbacks: Set<(code: string) => void> = new Set();

export const subscribeToCodeStream = (callback: (code: string) => void) => {
  streamingCodeCallbacks.add(callback);
  return () => {
    streamingCodeCallbacks.delete(callback);
  };
};

export const getStreamingCode = () => streamingCode;

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

    // Reset streaming code
    streamingCode = "";
    streamingCodeCallbacks.forEach((cb) => cb(""));

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
    let currentToolCalls: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }> = [];

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // Handle text deltas
            if (data.type === "text-delta") {
              currentText += data.content;
              yield {
                content: [
                  {
                    type: "text",
                    text: currentText,
                  },
                ],
              };
            }

            // Handle tool call arg deltas (for streaming code)
            if (data.type === "tool-call-arg-delta" && data.toolName === "execute_code" && data.argName === "code") {
              // Update streaming code
              // The value contains the raw JSON chunk, we need to extract the code from the accumulated JSON
              // Since JSON might be partial, we use a regex to extract the code value as it streams
              try {
                // The args are JSON being streamed, so we need to extract the code value
                // Look for "code": "..." pattern, handling partial JSON
                // Match: "code": " followed by any characters (including escaped) until closing quote or end
                const argsString = data.value || "";
                
                // Try to find the code value in the JSON string
                // Pattern: "code"\s*:\s*"([^"]*(?:\\.[^"]*)*)"
                // This matches "code": "value" where value can contain escaped characters
                const codeMatch = argsString.match(/"code"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
                if (codeMatch && codeMatch[1]) {
                  // Decode the code (handle escaped characters)
                  const code = codeMatch[1]
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, "\\")
                    .replace(/\\t/g, "\t")
                    .replace(/\\r/g, "\r");
                  
                  // Only update if we have meaningful content
                  if (code.trim().length > 0 || streamingCode.length === 0) {
                    streamingCode = code;
                    streamingCodeCallbacks.forEach((cb) => cb(code));
                  }
                } else {
                  // If we can't parse yet, try to extract partial code from incomplete JSON
                  // Look for "code": " and try to extract what we have so far
                  const partialMatch = argsString.match(/"code"\s*:\s*"([^"]*)/);
                  if (partialMatch && partialMatch[1]) {
                    const partialCode = partialMatch[1]
                      .replace(/\\n/g, "\n")
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, "\\")
                      .replace(/\\t/g, "\t")
                      .replace(/\\r/g, "\r");
                    
                    // Update with partial code
                    streamingCode = partialCode;
                    streamingCodeCallbacks.forEach((cb) => cb(partialCode));
                  }
                }
              } catch {
                // Ignore parsing errors for partial JSON
              }
            }

            // Handle complete messages
            if (data.type === "message") {
              if (data.role === "assistant") {
                currentText = data.content || "";
                currentToolCalls = data.toolCalls || [];
                
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
              } else if (data.role === "tool") {
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

            // Handle notifications
            if (data.type === "notification") {
              // Could emit custom events here if needed
            }

            // Handle completion
            if (data.type === "done") {
              // Finalize any pending content
              if (currentText) {
                yield {
                  content: [
                    {
                      type: "text",
                      text: currentText,
                    },
                  ],
                };
              }
            }

            // Handle errors
            if (data.type === "error") {
              throw new Error(data.error || "Unknown error");
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
                window.open("https://github.com/yourusername/manim-agent", "_blank");
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
        <div className="flex-1 h-full flex flex-col">
          {/* Top Row: Python Code */}
          <div className="h-1/2 border-b border-border/50 overflow-hidden">
            <ManimCodeDisplay />
          </div>

          {/* Bottom Row: Manim Video */}
          <div className="h-1/2 overflow-hidden">
            <ManimVideoDisplay />
          </div>
        </div>
      </div>
    </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

