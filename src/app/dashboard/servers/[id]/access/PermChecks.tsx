import type { Messages } from "@/i18n/messages";
import type { ServerPerm } from "@/lib/access";

type Props = { perms: readonly ServerPerm[]; checked: readonly ServerPerm[]; compact?: boolean; t: Messages["access"] };

/** The permission checkboxes, named "perms", with what each one allows. Compact leaves out what friends can always do. */
export default function PermChecks({ perms, checked, compact, t }: Props) {
  return (
    <fieldset className="stack-tight perm-checks">
      <legend className={compact ? "visually-hidden" : undefined}>{t.permsTitle}</legend>
      {!compact && <p className="muted small">{t.always}</p>}
      {perms.map((p) => (
        <label key={p} className="check">
          <input type="checkbox" name="perms" value={p} defaultChecked={checked.includes(p)} />
          <span>
            <strong>{t.perms[p].label}</strong> <span className="muted">· {t.perms[p].hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
