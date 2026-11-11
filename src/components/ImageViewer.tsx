import { useEffect } from "react";
import { OnceIcon, XIcon } from "./ui";

/** Full-screen photo viewer. In view-once mode there's no download and it's gone once closed. */
export function ImageViewer({
  src,
  caption,
  viewOnce,
  onClose,
}: {
  src: string;
  caption?: string;
  viewOnce?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={`fade-in fixed inset-0 z-50 flex flex-col ${viewOnce ? "bg-black" : "bg-black/95 backdrop-blur"}`}
      role="dialog"
      aria-modal="true"
      aria-label={viewOnce ? "View-once photo" : "Photo"}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        {viewOnce ? (
          <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <OnceIcon className="size-4" />
            View once · disappears when you close it
          </span>
        ) : (
          <a
            href={src}
            download
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
          >
            Save
          </a>
        )}
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
          aria-label="Close"
          autoFocus
        >
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img
          src={src}
          alt={caption || "Photo"}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={viewOnce ? (e) => e.preventDefault() : undefined}
          className={`pop-in max-h-full max-w-full rounded-lg object-contain ${viewOnce ? "no-callout" : ""}`}
        />
      </div>
      {caption && (
        <p className="p-4 text-center text-sm whitespace-pre-wrap text-white/90" onClick={(e) => e.stopPropagation()}>
          {caption}
        </p>
      )}
    </div>
  );
}
