// Responsável: usuários ativos com o tipo ao lado do nome ("Antenor (vendedor)").
import { TaSelect } from "@tailadmin";
import { useSession } from "../session";

export function UserSelect({ value, onChange, allowEmpty = true }: { value: string | null; onChange: (id: string | null) => void; allowEmpty?: boolean }) {
  const { users, label } = useSession();
  return (
    <TaSelect value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">Sem responsável</option>}
      {users
        .filter((u) => u.active || u.id === value)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {label(u)}
          </option>
        ))}
    </TaSelect>
  );
}
