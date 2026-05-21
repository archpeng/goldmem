import { useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function useSpeechRecognition(onSubmit: (text: string) => void, onError: (message: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  function handleMicClick() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const speechWindow = window as WindowWithSpeechRecognition;
    const SpeechRecognitionApi = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      onError("当前浏览器不支持语音输入，请使用文字输入。");
      return;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    transcriptRef.current = "";
    setTranscript("");
    recognition.onresult = (event) => {
      const nextTranscript = Array.from(event.results).map((result) => result[0].transcript).join("");
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
    };
    recognition.onend = () => {
      setIsListening(false);
      const finalTranscript = transcriptRef.current.trim();
      transcriptRef.current = "";
      setTranscript("");
      if (finalTranscript) onSubmit(finalTranscript);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  return {
    isListening,
    transcript,
    handleMicClick,
  };
}
