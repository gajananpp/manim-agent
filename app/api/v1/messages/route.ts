import { NextResponse } from 'next/server';
import { manimAgent } from '@/agents/executor/agent';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { parse as bestEffortParse } from 'best-effort-json-parser';

// Zod schema for message request body
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  tool_call_id: z.string().optional(),
});

const messagesRequestSchema = z.object({
  messages: z.array(messageSchema).optional().default([]),
});

export async function GET() {
  return NextResponse.json({ message: 'Hello from API!' });
}

export async function POST(request: Request) {
  // Get and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate request body using Zod
  const validationResult = messagesRequestSchema.safeParse(body);
  
  if (!validationResult.success) {
    const errorTree = z.treeifyError(validationResult.error);
    console.error('Invalid request body:', errorTree);
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: errorTree,
      },
      { status: 400 }
    );
  }

  const validatedBody = validationResult.data;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Helper function to send SSE data with optional event name
      const send = (data: string, eventName?: string) => {
        let message = '';
        if (eventName) {
          message += `event: ${eventName}\n`;
        }
        message += `data: ${data}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Convert validated messages to LangChain format
        const messages: BaseMessage[] = validatedBody.messages.map((msg) => {
          if (msg.role === 'user') {
            return new HumanMessage(msg.content);
          } else if (msg.role === 'assistant') {
            return new AIMessage(msg.content);
          } else if (msg.role === 'tool') {
            return new ToolMessage(msg.content, msg.tool_call_id || '');
          }
          return new HumanMessage(msg.content);
        });

        // Create SSE stream writer for tools
        const sseStream = {
          writeSSE: (data: { event: string; data: string }) => {
            send(data.data, data.event);
          },
        };

        // Use stream with streamMode: "messages" to get tool call chunks directly
        const messageStream = await manimAgent.stream(
          { messages },
          { 
            streamMode: 'messages',
            configurable: {
              sseStream,
            },
          },
        );

        // Accumulate tool call args so we can best-effort parse partial JSON and stream `code`
        // Keyed by toolCallChunk.id when available, otherwise by index.
        const toolArgsBufferByKey = new Map<string, string>();
        const lastCodeByKey = new Map<string, string>();
        // Track tool name/id across chunks (subsequent chunks often have `name`/`id` undefined)
        const toolNameByIndex = new Map<number, string>();
        const toolIdByIndex = new Map<number, string>();

        for await (const [message] of messageStream) {
          // Handle AI message chunks with tool calls
          // Check if message is an AIMessageChunk or has tool_call_chunks
          const isAIMessage = message.type === 'ai';
          const messageWithChunks = message as AIMessage & { tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }> };
          const hasToolCallChunks = isAIMessage && messageWithChunks.tool_call_chunks && messageWithChunks.tool_call_chunks.length > 0;
          
          if (hasToolCallChunks && messageWithChunks.tool_call_chunks) {
            for (const toolCallChunk of messageWithChunks.tool_call_chunks) {
              const chunkIndex = toolCallChunk.index ?? 0;
              if (toolCallChunk.name) toolNameByIndex.set(chunkIndex, toolCallChunk.name);
              if (toolCallChunk.id) toolIdByIndex.set(chunkIndex, toolCallChunk.id);
              const stableToolName = toolNameByIndex.get(chunkIndex);
              const stableToolCallId =
                toolIdByIndex.get(chunkIndex) ||
                toolCallChunk.id ||
                `index:${chunkIndex}`;

              // Stream the code argument as it's being built
              if (stableToolName === 'execute_code' && toolCallChunk.args) {
                // Stream the raw args chunk for code
                send(JSON.stringify({
                  type: 'tool-call-arg-delta',
                  toolCallId: stableToolCallId,
                  toolName: 'execute_code',
                  argName: 'code',
                  value: toolCallChunk.args, // Stream the chunk directly
                }), 'tool-call-arg-delta');

                // Best-effort parse the growing args JSON to extract `code`, then emit a dedicated SSE event.
                const key = stableToolCallId;
                const prev = toolArgsBufferByKey.get(key) || '';
                const next = prev + toolCallChunk.args;
                toolArgsBufferByKey.set(key, next);

                try {
                  const parsed = bestEffortParse(next) as unknown;
                  if (parsed && typeof parsed === 'object' && 'code' in (parsed as Record<string, unknown>)) {
                    const maybeCode = (parsed as Record<string, unknown>).code;
                    if (typeof maybeCode === 'string' && maybeCode.length > 0) {
                      const last = lastCodeByKey.get(key);
                      if (last !== maybeCode) {
                        lastCodeByKey.set(key, maybeCode);
                        send(
                          JSON.stringify({
                            code: maybeCode,
                            toolCallId: stableToolCallId,
                          }),
                          'code',
                        );
                      }
                    }
                  }
                } catch {
                  // best-effort parser shouldn't throw, but ignore if it does
                }
              }
            }
          }

          // Stream text content - handle both string and array formats
          if (message.content && isAIMessage) {
            if (typeof message.content === 'string') {
              // Simple string content
              send(JSON.stringify({
                type: 'text-delta',
                content: message.content,
              }), 'text-delta');
            } else if (Array.isArray(message.content) && isAIMessage) {
              // Content is an array of content blocks
              for (const contentBlock of message.content) {
                if (contentBlock && typeof contentBlock === 'object' && 'type' in contentBlock) {
                  if (contentBlock.type === 'text' && 'text' in contentBlock && typeof contentBlock.text === 'string') {
                    // Stream text from content block
                    send(JSON.stringify({
                      type: 'text-delta',
                      content: contentBlock.text,
                    }), 'text-delta');
                  }
                }
              }
            }
          }

          // Stream complete messages
          if (message.type === 'ai') {
            const aiMessage = message as AIMessage;
            // Extract text content from array format if needed
            let textContent = '';
            if (typeof aiMessage.content === 'string') {
              textContent = aiMessage.content;
            } else if (Array.isArray(aiMessage.content)) {
              textContent = aiMessage.content
                .filter((block: unknown) => {
                  return block && typeof block === 'object' && 'type' in block && (block as { type?: string }).type === 'text';
                })
                .map((block: unknown) => {
                  if (block && typeof block === 'object' && 'text' in block && typeof (block as { text?: unknown }).text === 'string') {
                    return (block as { text: string }).text;
                  }
                  return '';
                })
                .join('');
            }
            
            send(JSON.stringify({
              type: 'message',
              role: 'assistant',
              content: textContent,
              toolCalls: aiMessage.tool_calls || [],
            }), 'message');
          } else if (message.type === 'tool') {
            const toolMessage = message as ToolMessage;
            // Tool messages are already handled via SSE events from the tool itself
            // We still send the message for assistant-ui compatibility
            send(JSON.stringify({
              type: 'message',
              role: 'tool',
              content: typeof toolMessage.content === 'string' ? toolMessage.content : JSON.stringify(toolMessage.content),
              toolCallId: toolMessage.tool_call_id,
            }), 'message');
          }
        }

        // Send completion message
        send(JSON.stringify({ type: 'done', message: 'Stream completed' }), 'done');
      } catch (error) {
        console.error('Streaming error:', error);
        send(JSON.stringify({ 
          type: 'error', 
          error: error instanceof Error ? error.message : String(error) 
        }), 'error');
      } finally {
        controller.close();
      }
    },
  });

  // Return SSE response with proper headers
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
