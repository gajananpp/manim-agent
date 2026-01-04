"use client";

import { useAssistantState } from "@assistant-ui/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Code2 } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { subscribeToCodeStream, getStreamingCode } from "@/components/thread-wrapper";

export function ManimCodeDisplay() {
  const messages = useAssistantState((state) => state.thread.messages);
  const [streamingCode, setStreamingCode] = useState<string>("");
  
  // Subscribe to code streaming updates
  useEffect(() => {
    // Set initial value
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreamingCode(getStreamingCode());
    
    // Subscribe to updates
    const unsubscribe = subscribeToCodeStream((code) => {
      setStreamingCode(code);
    });
    
    return unsubscribe;
  }, []);
  
  const code = useMemo(() => {
    // If we have streaming code, use it (it's the most up-to-date)
    if (streamingCode) {
      return streamingCode;
    }
    
    // Otherwise, extract code from the latest tool call in messages
    // Find the latest tool call that contains code
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      
      // Check if message has tool calls
      if ("toolCalls" in message && message.toolCalls && Array.isArray(message.toolCalls)) {
        for (const toolCall of message.toolCalls) {
          if (toolCall.toolName === "execute_code" && toolCall.args) {
            const toolArgs = toolCall.args as { code?: string };
            if (toolArgs.code) {
              return toolArgs.code;
            }
          }
        }
      }
      
      // Also check assistant messages for code blocks
      if ("content" in message) {
        const content = (message as { content?: unknown }).content;
        if (typeof content === "string") {
          const codeBlockMatch = content.match(/```python\n([\s\S]*?)```/);
          if (codeBlockMatch) {
            return codeBlockMatch[1];
          }
        }
      }
    }
    
    return "";
  }, [messages, streamingCode]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 bg-muted/30 px-4 py-3 h-[52px] flex items-center">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Code2 className="h-4 w-4 text-primary" />
          <span>Python Code</span>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        <ScrollArea className="h-full">
          {code ? (
            <pre className="p-5 text-sm font-mono bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 leading-relaxed">
              <code className="text-slate-100">{code}</code>
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Code2 className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">No code generated yet</p>
              <p className="text-xs opacity-70">Code will appear here when the agent generates it</p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

