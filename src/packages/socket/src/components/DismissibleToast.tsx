import { PiX } from "../../../../lib/icons";

export interface DismissibleToastProps {
  message: string;
  onDismiss: () => void;
}

/* A toast you can get rid of before its time is up. Presentational:
   react-hot-toast renders into its own subtree, outside the providers. */
export function DismissibleToast({ message, onDismiss }: DismissibleToastProps) {
  return (
    <div className="dismissible-toast">
      <span className="dismissible-toast-message">{message}</span>
      <button
        type="button"
        className="dismissible-toast-close"
        aria-label="Hide this"
        onClick={onDismiss}
      >
        <PiX size={12} />
      </button>
    </div>
  );
}
