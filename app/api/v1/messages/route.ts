import { NextResponse } from 'next/server';
import { manimAgent } from '@/agents/executor/agent';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

export async function GET() {
  return NextResponse.json({ message: 'Hello from API!' });
}

export async function POST(request: Request) {
  // Get request body
  let body: { messages?: Array<{ role: string; content: string }> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

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
        // Convert messages to LangChain format
        const messages: BaseMessage[] = (body.messages || []).map((msg: { role: string; content: string; tool_call_id?: string }) => {
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

        for await (const [message] of messageStream) {
          // Handle AI message chunks with tool calls
          // Check if message is an AIMessageChunk or has tool_call_chunks
          const isAIMessage = message.type === 'ai';
          const messageWithChunks = message as AIMessage & { tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }> };
          const hasToolCallChunks = isAIMessage && messageWithChunks.tool_call_chunks && messageWithChunks.tool_call_chunks.length > 0;
          
          if (hasToolCallChunks && messageWithChunks.tool_call_chunks) {
            for (const toolCallChunk of messageWithChunks.tool_call_chunks) {
              // Stream the code argument as it's being built
              if (toolCallChunk.name === 'execute_code' && toolCallChunk.args) {
                // Stream the raw args chunk for code
                send(JSON.stringify({
                  type: 'tool-call-arg-delta',
                  toolCallId: toolCallChunk.id || '',
                  toolName: 'execute_code',
                  argName: 'code',
                  value: toolCallChunk.args, // Stream the chunk directly
                }), 'tool-call-arg-delta');
              }
            }
          }

          // Stream text content
          if (message.content && typeof message.content === 'string') {
            send(JSON.stringify({
              type: 'text-delta',
              content: message.content,
            }), 'text-delta');
          }

          // Stream complete messages
          if (message.type === 'ai') {
            const aiMessage = message as AIMessage;
            send(JSON.stringify({
              type: 'message',
              role: 'assistant',
              content: aiMessage.content,
              toolCalls: aiMessage.tool_calls || [],
            }), 'message');
          } else if (message.type === 'tool') {
            const toolMessage = message as ToolMessage;
            send(JSON.stringify({
              type: 'message',
              role: 'tool',
              content: toolMessage.content,
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
