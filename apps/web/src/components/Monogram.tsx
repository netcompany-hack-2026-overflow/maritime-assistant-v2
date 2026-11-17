/** "Tw" monogram in the serif italic, used as the Tidewise logo. */
export function Monogram({ className = "" }: { className?: string }) {
  return (
    <span className={`monogram ${className}`} aria-hidden="true">
      T<span className="monogram__w">w</span>
    </span>
  );
}
