import { TaButton, TaModal } from "@tailadmin";

export function ComingSoonModal({ feature, onClose }: { feature: string | null; onClose: () => void }) {
  return (
    <TaModal isOpen={feature !== null} onClose={onClose} title={feature ?? ""}>
      <p className="text-theme-sm text-gray-600 dark:text-gray-300">Este recurso será entregue nas próximas fases.</p>
      <div className="mt-5 flex justify-end">
        <TaButton variant="primary" onClick={onClose}>
          Ok
        </TaButton>
      </div>
    </TaModal>
  );
}
