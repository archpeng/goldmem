import type { RefObject } from "react";
import { Mic, Send } from "lucide-react";
import { copy } from "../lib/copy.js";

export function ElderInputBar({
  inputRef,
  inputText,
  isListening,
  loading,
  transcript,
  onInputChange,
  onMicClick,
  onSubmit,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  isListening: boolean;
  loading: boolean;
  transcript: string;
  onInputChange: (value: string) => void;
  onMicClick: () => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-20 mx-auto w-full max-w-[430px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:absolute sm:inset-x-auto sm:w-[430px]">
      {isListening && transcript ? (
        <p className="mb-2 px-4 text-center text-sm text-slate-500">{transcript}</p>
      ) : null}
      <form
        className="rounded-[1.75rem] border border-slate-100 bg-white/95 p-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(inputText);
        }}
      >
        <label className="sr-only" htmlFor="elder-turn-input">{copy.conversation.inputLabel}</label>
        <textarea
          aria-label={copy.conversation.inputLabel}
          className="max-h-28 min-h-12 w-full resize-none rounded-3xl border-0 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:bg-slate-100"
          disabled={loading}
          id="elder-turn-input"
          placeholder={copy.conversation.placeholder}
          ref={inputRef}
          value={inputText}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            aria-label={copy.conversation.voiceAction}
            className={`flex h-16 flex-[3] items-center justify-center gap-2 rounded-full text-base font-semibold text-white shadow-sm transition-all ${isListening ? "scale-[1.02] bg-slate-700" : "bg-slate-950 hover:bg-slate-800"} ${loading ? "opacity-50" : ""}`}
            disabled={loading}
            type="button"
            onClick={onMicClick}
          >
            <Mic className={`h-6 w-6 ${isListening ? "animate-pulse" : ""}`} />
            {isListening ? copy.conversation.listening : copy.conversation.voiceAction}
          </button>
          <button
            aria-label={copy.conversation.send}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
            disabled={loading || !inputText.trim()}
            type="submit"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
