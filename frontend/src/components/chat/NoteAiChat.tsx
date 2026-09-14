import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, Sparkles, AlertCircle, ChevronDown, ChevronUp, FileText, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Source {
  chunkId: string;
  noteId: string;
  noteTitle: string;
  fileName: string;
  pageNumber: number | null;
  similarity: number;
  contentExcerpt: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  createdAt: string;
}

interface NoteAiChatProps {
  noteId: string;
  noteTitle: string;
  isReady: boolean;
}

export const NoteAiChat: React.FC<NoteAiChatProps> = ({ noteId, noteTitle, isReady }) => {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSourceMsgId, setExpandedSourceMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize or restore session for this note
  useEffect(() => {
    if (!user || !isReady) return;

    let isMounted = true;

    async function initSession() {
      try {
        // Check existing sessions
        const res = await api.get('/chat/sessions');
        const existing = res.data.data?.find((s: any) => s.noteId === noteId);

        if (existing) {
          if (!isMounted) return;
          setSessionId(existing.id);
          // Fetch messages
          const sessionDetail = await api.get(`/chat/sessions/${existing.id}`);
          const history = sessionDetail.data.data.messages.map((m: any) => ({
            id: m.id,
            role: m.role.toLowerCase(),
            content: m.content,
            sources: m.sources,
            createdAt: m.createdAt,
          }));
          if (isMounted) setMessages(history);
        } else {
          // Create new session scoped to this note
          const createRes = await api.post('/chat/sessions', {
            title: `Study Chat: ${noteTitle.slice(0, 30)}`,
            noteId,
          });
          if (isMounted) setSessionId(createRes.data.data.id);
        }
      } catch (err: any) {
        console.error('Error initializing chat session:', err);
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, [noteId, user, isReady, noteTitle]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (queryText?: string) => {
    const query = (queryText || inputQuery).trim();
    if (!query || isLoading || !isReady) return;

    setInputQuery('');
    setError(null);

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    try {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        // Fallback: create session on the fly
        const sRes = await api.post('/chat/sessions', {
          title: `Study: ${noteTitle}`,
          noteId,
        });
        currentSessionId = sRes.data.data.id;
        setSessionId(currentSessionId);
      }

      const res = await api.post(`/chat/sessions/${currentSessionId}/messages`, {
        content: query,
      });

      const assistantData = res.data.data.assistantMessage;

      const assistantMsg: Message = {
        id: assistantData.id,
        role: 'assistant',
        content: assistantData.content,
        sources: assistantData.sources,
        createdAt: assistantData.createdAt,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Failed to send message:', err);
      const errMsg = err.response?.data?.message || 'Failed to get answer from AI. Please try again.';
      setError(errMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleQuestions = [
    'Summarize the core topics covered in these notes.',
    'What are the key formulas or definitions mentioned?',
    'What are 3 important exam questions from this document?',
  ];

  if (!isReady) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <Bot className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-bold text-slate-900">AI Study Assistant</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Text processing and vector embeddings are being prepared for this document. The AI assistant will be ready once status is Completed.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col h-[560px]">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-brand-50 to-indigo-50/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <span>CampusNotes AI Assistant</span>
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> RAG Grounded
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Answers are grounded strictly in this document&apos;s verified text
            </p>
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-grow p-4 overflow-y-auto space-y-4 text-xs">
        {messages.length === 0 ? (
          <div className="text-center py-8 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
              <Bot className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-slate-800 text-sm">Ask Anything About These Notes</h4>
              <p className="text-slate-400 text-xs max-w-sm mx-auto">
                Gemini vector retrieval searches through all pages to answer your questions with exact page citations.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2 max-w-sm mx-auto">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left">
                Suggested Prompts
              </span>
              {sampleQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(q)}
                  className="text-left text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-brand-50 hover:border-brand-200 hover:text-brand-900 transition-colors text-slate-700 font-medium"
                >
                  &ldquo;{q}&rdquo;
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-3.5 leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-none'
                    : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-bl-none'
                }`}
              >
                <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                {/* Grounded Source Citations */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200/80">
                    <button
                      onClick={() =>
                        setExpandedSourceMsgId(expandedSourceMsgId === msg.id ? null : msg.id)
                      }
                      className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 hover:text-brand-700 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-brand-600" />
                      <span>Referenced Sources ({msg.sources.length})</span>
                      {expandedSourceMsgId === msg.id ? (
                        <ChevronUp className="w-3 h-3 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-slate-400" />
                      )}
                    </button>

                    {expandedSourceMsgId === msg.id && (
                      <div className="mt-2 space-y-2">
                        {msg.sources.map((src, sIdx) => (
                          <div
                            key={src.chunkId || sIdx}
                            className="bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] space-y-1 font-sans"
                          >
                            <div className="flex items-center justify-between text-slate-700 font-semibold">
                              <span>
                                {src.noteTitle} • Page {src.pageNumber || 1}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-mono text-[10px]">
                                {Math.round(src.similarity * 100)}% match
                              </span>
                            </div>
                            <p className="text-slate-500 font-mono text-[10px] leading-normal line-clamp-2">
                              &ldquo;{src.contentExcerpt}&rdquo;
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-start gap-2 text-xs text-slate-500">
            <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center animate-pulse">
              <Bot className="w-4 h-4 text-slate-400" />
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl rounded-bl-none border border-slate-200 flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-brand-400 border-t-brand-600 rounded-full animate-spin" />
              <span>Searching pgvector & generating grounded answer...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Field */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/50">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="Ask a question about this document..."
            disabled={isLoading}
            className="flex-grow text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-slate-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isLoading}
            className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white transition-all shadow-sm flex-shrink-0"
            title="Send Question"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
