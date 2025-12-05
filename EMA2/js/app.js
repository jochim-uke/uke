function splitIndications(text) {
  let t = safe(text);
  if (!t) return [];

  // Abkürzungen maskieren, damit an diesen Punkten nicht gesplittet wird
  t = t
    .replace(/\be\.g\./gi, "__EG__")
    .replace(/\bi\.e\./gi, "__IE__")
    .replace(/\bd\.d\./gi, "__DD__")
    .replace(/\bk\.s\./gi, "__KS__");

  // Standard-Splitting: Semikolon, Punkt+Leerzeichen oder Punkt+Buchstabe
  const parts = t.split(/;|\.(?=[A-Za-z])|\.\s+/);

  // Masken zurück in echte Abkürzungen wandeln
  return parts
    .map(s => s
      .replace(/__EG__/g, "e.g.")
      .replace(/__IE__/g, "i.e.")
      .replace(/__DD__/g, "d.d.")
      .replace(/__KS__/g, "k.s.")
      .trim()
    )
    .filter(Boolean);
}