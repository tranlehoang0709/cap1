export type PendingChatTurn = { id: string; content: string; conversation: string; prepared?: string };

// Keep the same ID and exact prepared input while retrying a failed request.
// New Chat passes null; a successful response clears the pending turn.
export function pendingChatTurn(previous: PendingChatTurn | null, content: string,
    conversation: string, createId = () => crypto.randomUUID()): PendingChatTurn {
    return previous?.content === content && previous.conversation === conversation
        ? previous : { id: createId(), content, conversation };
}
