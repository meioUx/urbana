export async function navigate(page, title) {
  const groups = {
    Ocorrências: "Ocorrências",
    Triagem: "Ocorrências",
    "Ordens de serviço": "Ocorrências",
    "Análise de campo": "Ocorrências",
    "Controle do setor": "Operações",
    Equipes: "Operações",
    Materiais: "Operações",
    Equipamentos: "Operações",
    "Operação de campo": "Operações",
  };
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  const group = groups[title];
  if (group) {
    const toggle = nav.getByRole("button", { name: group, exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
  }
  await nav
    .getByRole("button", {
      name: title === "Ocorrências" ? "Todas as ocorrências" : title,
      exact: title !== "Triagem",
    })
    .click();
}
