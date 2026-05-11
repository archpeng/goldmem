import { Button } from "./ui/button.js";
import { copy } from "../lib/copy.js";

export function EmptyConversation({ onPickExample }: { onPickExample: (value: string) => void }) {
  const examples = [copy.conversation.exampleRecord, copy.conversation.exampleRecall, copy.conversation.exampleMixed];
  return (
    <section className="grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
      <p className="text-xl font-semibold leading-8 text-slate-950">{copy.conversation.emptyTitle}</p>
      <p className="text-lg leading-8 text-slate-600">{copy.conversation.emptyBody}</p>
      <div className="grid gap-2">
        {examples.map((example) => (
          <Button className="h-auto justify-start rounded-xl px-4 py-3 text-left text-base leading-7" key={example} type="button" variant="secondary" onClick={() => onPickExample(example)}>
            {example}
          </Button>
        ))}
      </div>
    </section>
  );
}
