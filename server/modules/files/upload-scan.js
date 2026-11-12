import { failCode } from "../../http/errors.js";

export const MALWARE_MESSAGE =
  "O arquivo foi recusado pela verificação de segurança e não foi salvo.";
export const SCAN_UNAVAILABLE_MESSAGE =
  "Não foi possível verificar a segurança do arquivo agora. Tente novamente em instantes.";

// Policy around an injected scanner ({ enabled, failMode, scan(bytes) }), shared by the evidence and
// invoice uploads. Call it after the cheap checks and before anything is saved. With no scanner it
// returns immediately (nothing changes for deployments that do not set CLAMAV_HOST).
//
// Returns { infected: false } when the file may proceed, or { infected: true } when it was refused;
// the signature name goes to the log only. Throws 503 SCAN_UNAVAILABLE when the scanner fails in
// fail-closed mode; in fail-open mode the failure is logged as a warning and the file proceeds.
export async function scanUpload({
  scanner,
  logger,
  req,
  bytes,
  originalName,
}) {
  if (!scanner?.enabled) return { infected: false };
  let result;
  try {
    result = await scanner.scan(bytes);
  } catch (err) {
    const context = {
      requestId: req.id,
      userId: req.user?.id,
      scanError: err.code,
      err,
    };
    if (scanner.failMode === "open") {
      logger.warn(
        "Verificação antimalware indisponível; arquivo aceito sem análise (CLAMAV_FAIL_MODE=open).",
        context,
      );
      return { infected: false };
    }
    logger.error(
      "Verificação antimalware indisponível; arquivo recusado (CLAMAV_FAIL_MODE=closed).",
      context,
    );
    failCode(503, SCAN_UNAVAILABLE_MESSAGE, "SCAN_UNAVAILABLE");
  }
  if (result?.status === "clean") return { infected: false };
  if (result?.status !== "infected") {
    // A scanner that answers neither clean nor infected is treated like an outage.
    const err = new Error("Resultado de análise desconhecido.");
    logger.error("Verificação antimalware retornou resultado inesperado.", {
      requestId: req.id,
      err,
    });
    if (scanner.failMode === "open") return { infected: false };
    failCode(503, SCAN_UNAVAILABLE_MESSAGE, "SCAN_UNAVAILABLE");
  }
  logger.warn("Upload recusado: malware detectado.", {
    requestId: req.id,
    userId: req.user?.id,
    signature: result.signature,
    originalName: String(originalName || "").slice(0, 200),
    size: bytes.length,
  });
  return { infected: true };
}

// Body of the 422 answer. Sent through route() (res.status(422); return body) so the audit row
// written for the refusal commits with the transaction while no file or evidence row is created.
export const malwareResponse = (res) => {
  res.status(422);
  return { error: MALWARE_MESSAGE, code: "MALWARE_DETECTED" };
};
