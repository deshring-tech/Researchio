'use client';

import { useEffect, useRef, useState } from 'react';

import type { CitationRef } from '@/server/services/chat.service';
import { LIMITS } from '@/lib/validation/schemas';

/**
 * MODULE: components/workspace/ChatPanel
 *
 * Purpose
 *   The interactive research assistant: sends a question, renders the streamed
 *   answer, and lists the sources that grounded it.
 *
 * Behaviour notes
 *   - Streaming is consumed from an SSE response; tokens append to a transient
 *     message that becomes permanent on completion.
 *   - An in-flight request is aborted if the component unmounts, so navigating
 *     away does not leave a dangling reader.
 *   - The transcript only auto-scrolls when the user is already near the
 *     bottom. Yanking the view down while someone is reading earlier output is
 *     a common and irritating bug in chat UIs.
 */

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: CitationRef[];
}

type StreamEvent =
  | { type: 'token'; value: string }
  | { type: 'done'; citations: CitationRef[] }
  | { type: 'error'; message: string };

/** Distance from the bottom, in pixels, still considered "at the bottom". */
const AUTOSCROLL_THRESHOLD = 120;

export function ChatPanel({
  projectId,
  aiEnabled,
  initialMessages,
}: {
  projectId: string;
  aiEnabled: boolean;
  initialMessages: ChatMessageView[];
}) {
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight request when the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceFromBottom < AUTOSCROLL_THRESHOLD) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, streamingText]);

  async function send(question: string) {
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setError(null);
    setStreamingText('');
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', content: question, citations: [] },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: question }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'The assistant is unavailable right now.');
      }

      await consumeStream(response.body, controller.signal, {
        onToken: (value) => setStreamingText((current) => current + value),
        onDone: (citations) => {
          setStreamingText((finalText) => {
            if (finalText.length > 0) {
              setMessages((current) => [
                ...current,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: finalText,
                  citations,
                },
              ]);
            }
            return '';
          });
        },
        onError: (message) => setError(message),
      });
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        setError((caught as Error).message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const question = input.trim();

    if (question.length === 0 || isStreaming) {
      return;
    }

    setInput('');
    void send(question);
  }

  const disabled = !aiEnabled || isStreaming;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !isStreaming ? (
          <p className="text-sm muted">
            {aiEnabled
              ? 'Ask a question about your sources and notes. Answers cite the passages they came from.'
              : 'The assistant is unavailable until an AI key is configured.'}
          </p>
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {streamingText.length > 0 ? (
          <div className="chat-bubble" data-role="assistant" aria-live="polite">
            {streamingText}
          </div>
        ) : null}

        {isStreaming && streamingText.length === 0 ? (
          <div className="chat-bubble" data-role="assistant">
            <span className="spinner" aria-hidden="true" /> Searching your sources…
          </div>
        ) : null}

        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="row" style={{ marginTop: 'auto', flexWrap: 'nowrap' }}>
        <label className="sr-only" htmlFor="assistant-input">
          Ask the research assistant
        </label>
        <input
          id="assistant-input"
          className="input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={aiEnabled ? 'Ask a question…' : 'Unavailable'}
          maxLength={LIMITS.chatMessageMax}
          disabled={disabled}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || input.trim().length === 0}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessageView }) {
  return (
    <div>
      <div className="chat-bubble" data-role={message.role}>
        {message.content}
      </div>

      {message.citations.length > 0 ? (
        <div
          className="row"
          style={{ gap: 'var(--spacing-1)', marginTop: 'var(--spacing-2)' }}
        >
          {message.citations.map((citation) => (
            <span key={citation.label} className="pill pill-ai" title={citation.title}>
              {citation.label} ·{' '}
              {citation.title.length > 24
                ? `${citation.title.slice(0, 24)}…`
                : citation.title}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reads an SSE body and dispatches each event.
 *
 * Buffers partial lines: a network chunk can split an event mid-JSON, and
 * parsing eagerly would throw on perfectly valid traffic.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  handlers: {
    onToken: (value: string) => void;
    onDone: (citations: CitationRef[]) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      let event: StreamEvent;
      try {
        event = JSON.parse(line.slice('data:'.length).trim()) as StreamEvent;
      } catch {
        continue;
      }

      if (event.type === 'token') {
        handlers.onToken(event.value);
      } else if (event.type === 'done') {
        handlers.onDone(event.citations);
      } else {
        handlers.onError(event.message);
      }
    }
  }
}
