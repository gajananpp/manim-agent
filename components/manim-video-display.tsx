"use client";

import { useAssistantState } from "@assistant-ui/react";
import { Video } from "lucide-react";
import { useMemo } from "react";

export function ManimVideoDisplay() {
  const messages = useAssistantState((state) => state.thread.messages);
  
  const videoUrl = useMemo(() => {
    // Extract video URL from tool messages
    // Find the latest tool message that contains a video URL
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      
      // Check if it's a tool message with video URL
      if ("content" in message) {
        const content = (message as { content?: unknown }).content;
        if (typeof content === "string") {
          // Look for video URL pattern: /api/videos/...
          const videoUrlMatch = content.match(/\/api\/videos\/[^\s\n]+/);
          if (videoUrlMatch) {
            return videoUrlMatch[0];
          }
        }
      }
    }
    
    return null;
  }, [messages]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 bg-muted/30 px-4 py-3 h-[52px] flex items-center">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Video className="h-4 w-4 text-primary" />
          <span>Manim Video</span>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden flex items-center justify-center bg-gradient-to-br from-slate-950/50 via-slate-900/30 to-slate-950/50 dark:from-slate-950/80 dark:via-slate-900/60 dark:to-slate-950/80 min-h-0">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="max-w-full max-h-full rounded-xl shadow-2xl ring-2 ring-border/20"
            style={{ maxHeight: "calc(100% - 2rem)" }}
          >
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Video className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">No video available yet</p>
            <p className="text-xs opacity-70">Video will appear here after code execution</p>
          </div>
        )}
      </div>
    </div>
  );
}

