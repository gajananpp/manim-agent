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

const MyModelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // Placeholder adapter - will be connected to API route later
    // This allows the UI to render without errors
    // Return empty content to satisfy the adapter interface
    yield {
      content: [
        {
          type: "text",
          text: "",
        },
      ],
    };
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
      <div className="flex h-full w-full overflow-hidden bg-gradient-to-br from-background via-background to-muted/20">
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

