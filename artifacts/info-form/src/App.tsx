import { useState } from "react";

type Field = { key: string; value: string };

function App() {
  const [fields, setFields] = useState<Field[]>([
    { key: "", value: "" },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (index: number, part: "key" | "value", val: string) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [part]: val };
      return next;
    });
  };

  const addField = () => {
    setFields((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2500);
  };

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[#16213e] border border-[#0f3460] rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#0f3460]">
            <svg
              className="w-4 h-4 text-[#a78bfa]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="text-white font-semibold text-sm tracking-wide">
              Info
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            {/* Column headers */}
            <div className="flex gap-2 px-1">
              <span className="flex-1 text-xs text-[#8892a4] font-medium uppercase tracking-wider">
                Key
              </span>
              <span className="flex-1 text-xs text-[#8892a4] font-medium uppercase tracking-wider">
                Value
              </span>
              <span className="w-7" />
            </div>

            {/* Fields */}
            <div className="space-y-2">
              {fields.map((field, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Key"
                    value={field.key}
                    onChange={(e) => updateField(i, "key", e.target.value)}
                    className="flex-1 bg-[#0d1b2a] border border-[#0f3460] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-[#a78bfa] transition-colors"
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={field.value}
                    onChange={(e) => updateField(i, "value", e.target.value)}
                    className="flex-1 bg-[#0d1b2a] border border-[#0f3460] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-[#a78bfa] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length === 1}
                    className="w-7 h-7 flex items-center justify-center text-[#4a5568] hover:text-[#ef4444] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add field */}
            <button
              type="button"
              onClick={addField}
              className="flex items-center gap-1.5 text-xs text-[#a78bfa] hover:text-[#c4b5fd] transition-colors mt-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add field
            </button>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full bg-[#a78bfa] hover:bg-[#9061f9] text-white font-semibold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {submitted ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Submitted!
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
