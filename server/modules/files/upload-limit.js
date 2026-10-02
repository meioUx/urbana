// Bound the number of multipart buffers held before serialized database processing.
export function createUploadGuard(maximum = 4) {
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new TypeError("Limite de uploads inválido.");
  let active = 0;
  return (req, res, next) => {
    if (active >= maximum)
      return res
        .status(429)
        .json({
          error: "Há vários arquivos em envio. Aguarde e tente novamente.",
          code: "UPLOAD_BUSY",
        });
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
