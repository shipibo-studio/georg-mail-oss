// The georg mail mark: georg-ds's symbol inline, so it follows the theme, and the product name,
// which is its label. The symbol's square keeps georg mail's fuchsia whatever accent is picked.
import GEORG_SYMBOL from "@shipibo-studio/georg-ds/brand/symbol.svg?raw";

export function Brand() {
  return (
    <div className="brand">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed file from the design system, built in, never user content */}
      <span className="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GEORG_SYMBOL }} />
      <div className="brand-name">
        Georg <span>mail</span>
      </div>
    </div>
  );
}
