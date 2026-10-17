// "Adicionar foto" (contato, redonda) / "Adicionar logo" (organização,
// quadrada). A imagem é reduzida para 256 px antes de ir para o banco.
import { useEffect, useRef, useState } from "react";
import { Building2, User } from "lucide-react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";

async function resize(file: File, max = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
}

/** Carrega as imagens (data URL) de uma lista de ids de anexo. */
export function useImages(ids: (string | null | undefined)[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = ids.filter(Boolean).join(",");
  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    if (wanted.length === 0) return;
    void call("attachments.dataUrls", { ids: wanted }).then((m) => setMap((cur) => ({ ...cur, ...m })));
  }, [key]);
  return map;
}

export function ImageUpload({
  value,
  onChange,
  shape,
  entityType,
}: {
  value: string | null;
  onChange: (attachmentId: string | null) => void;
  shape: "round" | "square";
  entityType: "person" | "organization";
}) {
  const input = useRef<HTMLInputElement>(null);
  const images = useImages([value]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const src = preview ?? (value ? images[value] : undefined);
  const round = shape === "round";

  return (
    <div className="mb-4 flex flex-col items-center">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          "flex h-20 w-20 items-center justify-center overflow-hidden",
          round ? "rounded-full bg-purple-100 text-purple-700" : "rounded-2xl bg-warning-100 text-warning-700",
        )}
      >
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : round ? <User size={34} /> : <Building2 size={34} />}
      </button>
      <div className="mt-1.5 flex gap-3 text-theme-sm">
        <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => input.current?.click()}>
          {src ? "Trocar" : round ? "Adicionar foto" : "Adicionar logo"}
        </button>
        {src && (
          <button
            type="button"
            className="text-gray-500 hover:text-error-600"
            onClick={() => {
              setPreview(null);
              onChange(null);
            }}
          >
            Remover
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-theme-xs text-error-600">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            const dataUrl = await resize(file);
            const id = await call("attachments.saveImage", { entityType, filename: file.name, dataUrl });
            setPreview(dataUrl);
            setError(null);
            onChange(id);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </div>
  );
}
