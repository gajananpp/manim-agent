import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { manimChain } from "./chain";
import { Configurable, executeCodeTool } from "./tools/execute-code";

const GraphAnnotation = Annotation.Root({
	messages: Annotation<BaseMessage[]>({
		default: () => [],
		reducer: (x, y) =>[...x, ...y],
	})
});

const tools = [executeCodeTool];
const toolNode = new ToolNode(tools);


async function callManimChain(
	{ messages }: typeof GraphAnnotation.State,
	config: RunnableConfig,
) {
	// Get configurable from config if available
	const { sseStream } = config.configurable as Configurable;

	// Notify start
	if (sseStream) {
		sseStream.writeSSE({
			event: "notification",
			data: JSON.stringify({
				content: "Thinking...",
				id: Bun.randomUUIDv7(),
				status: "started",
			}),
		});
	}

	const response = await manimChain.invoke(
		{
			messages: messages,
		},
		{
			...config,
			tags: ["manim"],
		},
	);
	return {
		messages: [response],
	};
}

function shouldContinue({ messages }: typeof GraphAnnotation.State) {
	const lastMessage = messages.at(-1) as AIMessage;
	if (lastMessage.tool_calls?.length) {
		return "tools";
	}
	return END;
}

const graph = new StateGraph(GraphAnnotation)
	.addNode("manim", callManimChain)
	.addNode("tools", toolNode)
	.addEdge(START, "manim")
	.addConditionalEdges("manim", shouldContinue)
	.addEdge("tools", "manim");

export const manimAgent = graph.compile();
