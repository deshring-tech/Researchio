import { ChatPanel } from '@/components/workspace/ChatPanel';
import { listMessages } from '@/server/services/chat.service';

/**
 * MODULE: components/workspace/ResearchAssistant
 *
 * Purpose
 *   Server-side wrapper that loads conversation history and hands it to the
 *   interactive panel.
 *
 * Why split
 *   History comes from the database, which a Client Component cannot query.
 *   Loading it here means the conversation is present in the first HTML paint
 *   rather than appearing after a client round-trip.
 */
export async function ResearchAssistant({
  projectId,
  aiEnabled,
}: {
  projectId: string;
  aiEnabled: boolean;
}) {
  const messages = await listMessages(projectId);

  return (
    <ChatPanel
      projectId={projectId}
      aiEnabled={aiEnabled}
      initialMessages={messages.map((message) => ({
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
        citations: message.citations,
      }))}
    />
  );
}
