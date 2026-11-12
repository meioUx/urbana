import { useState } from "react";
import type { Boot } from "../../shared/types";
import { Field } from "../../shared/ui";
import { Check } from "lucide-react";

export default function SettingsForm({
  boot,
  save,
}: {
  boot: Boot;
  save: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState({
    municipality: boot.settings.municipality,
    duplicate_radius: boot.settings.duplicate_radius,
  });
  return (
    <form
      data-guide="settings"
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(d);
      }}
    >
      <Field label="Município">
        <input
          required
          value={d.municipality}
          onChange={(e) => setD({ ...d, municipality: e.target.value })}
        />
      </Field>
      <Field label="Raio de duplicidade e reincidência (metros)">
        <input
          required
          type="number"
          min="1"
          max="500"
          value={d.duplicate_radius}
          onChange={(e) =>
            setD({ ...d, duplicate_radius: Number(e.target.value) })
          }
        />
      </Field>
      <button className="button primary">
        <Check size={16} />
        Salvar configurações
      </button>
    </form>
  );
}
