# Bibliotecas de terceiros

- `wppconnect-wa.js` — [WA-JS](https://github.com/wppconnect-team/wa-js)
  (`@wppconnect/wa-js` 4.7.1, Apache-2.0, licença em
  `wppconnect-wa.LICENSE.txt`). Injetada na aba do WhatsApp Web só para enviar
  os lembretes de atividades pelo WhatsApp (spec 10). Para atualizar:
  `npm pack @wppconnect/wa-js@<versão>` e copiar `package/dist/wppconnect-wa.js`.
  Ao trocar a versão, atualize também `WA_JS_VERSION` em
  `src/lib/notify/waweb.ts`: a aba do WhatsApp com a versão antiga é
  recarregada antes do próximo envio.
