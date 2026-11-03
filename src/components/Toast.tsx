import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

export type ToastMessage = {
  id: number;
  message: string;
  tone: ToastTone;
};

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastMessage | null;
  onClose: () => void;
}) {
  if (!toast) return null;
  const Icon = ICONS[toast.tone];
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role="status"
      aria-live="polite"
      key={toast.id}
    >
      <Icon size={18} />
      <p>{toast.message}</p>
      <button type="button" onClick={onClose} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  );
}
