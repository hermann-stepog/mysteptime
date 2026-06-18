import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type FieldKey = "descricao" | "categoria" | "code" | "__ignore__";

const FIELD_LABELS: Record<FieldKey, string> = {
  descricao: "Descrição",
  categoria: "Categoria",
  code: "Código",
  __ignore__: "Ignorar",
};

const ALIASES: Record<Exclude<FieldKey, "__ignore__">, string[]> = {
  descricao: ["descricao", "descrição", "description", "item", "produto", "material", "nome", "name"],
  categoria: ["categoria", "category", "tipo", "type", "grupo", "group", "classe"],
  code: ["codigo", "código", "code", "cod", "sku", "ref", "referencia", "referência"],
};

const norm = (s: string) =>
  s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").trim();

function autoMatch(header: string): FieldKey {
  const n = norm(header);
  if (!n) return "__ignore__";
  for (const [field, list] of Object.entries(ALIASES) as [Exclude<FieldKey, "__ignore__">, string[]][]) {
    if (list.some((a) => norm(a) === n || n.includes(norm(a)))) return field;
  }
  return "__ignore__";
}

export function ImportMaterialsDialog() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [mapping, setMapping] = useState<FieldKey[]>([]);

  const reset = () => {
    setOpen(false);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
      // detect first non-empty row as header
      const headerIdx = matrix.findIndex((r) => r.some((c) => String(c ?? "").trim() !== ""));
      if (headerIdx < 0) {
        toast.error("Planilha vazia");
        return;
      }
      const hs = matrix[headerIdx].map((c, i) => String(c ?? "").trim() || `Coluna ${i + 1}`);
      const dataRows = matrix.slice(headerIdx + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
      setFileName(file.name);
      setHeaders(hs);
      setRows(dataRows);
      setMapping(hs.map(autoMatch));
      setOpen(true);
    } catch (e: any) {
      toast.error(e.message || "Falha ao ler arquivo");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const descIdx = mapping.indexOf("descricao");
  const catIdx = mapping.indexOf("categoria");
  const codeIdx = mapping.indexOf("code");
  const ignoredCols = headers.filter((_, i) => mapping[i] === "__ignore__");

  const mapped = rows.map((r) => ({
    descricao: descIdx >= 0 ? String(r[descIdx] ?? "").trim() : "",
    categoria: catIdx >= 0 ? String(r[catIdx] ?? "").trim() || null : null,
    code: codeIdx >= 0 ? String(r[codeIdx] ?? "").trim() || null : null,
  }));
  const validRows = mapped.filter((r) => r.descricao);
  const skipped = mapped.length - validRows.length;
  const canImport = descIdx >= 0 && validRows.length > 0;

  // detect duplicate field assignments
  const assignedCounts = mapping.reduce<Record<string, number>>((acc, k) => {
    if (k !== "__ignore__") acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const dupFields = Object.entries(assignedCounts).filter(([, n]) => n > 1).map(([k]) => FIELD_LABELS[k as FieldKey]);

  const importMut = useMutation({
    mutationFn: async () => {
      const withCode = validRows.filter((r) => r.code);
      const withoutCode = validRows.filter((r) => !r.code);
      if (withCode.length) {
        const { error } = await supabase.from("materials").upsert(withCode, { onConflict: "code" });
        if (error) throw error;
      }
      if (withoutCode.length) {
        const { error } = await supabase.from("materials").insert(withoutCode);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["materials-all"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      toast.success(`${validRows.length} materiais importados${skipped ? `, ${skipped} ignorados` : ""}`);
      reset();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setCol = (i: number, v: FieldKey) =>
    setMapping((m) => m.map((x, idx) => (idx === i ? v : x)));

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button variant="outline" onClick={() => fileRef.current?.click()}>
        <Upload className="mr-2 h-4 w-4" />
        Importar planilha
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prévia da importação</DialogTitle>
            <p className="text-xs text-muted-foreground">{fileName}</p>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Linhas lidas" value={rows.length} />
              <Stat label="Válidas" value={validRows.length} tone="success" />
              <Stat label="Ignoradas" value={skipped} tone={skipped ? "warning" : "muted"} />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Mapeamento de colunas</h3>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coluna na planilha</TableHead>
                      <TableHead>Mapear para</TableHead>
                      <TableHead>Exemplo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {headers.map((h, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{h}</TableCell>
                        <TableCell>
                          <Select value={mapping[i]} onValueChange={(v) => setCol(i, v as FieldKey)}>
                            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="descricao">Descrição</SelectItem>
                              <SelectItem value="categoria">Categoria</SelectItem>
                              <SelectItem value="code">Código</SelectItem>
                              <SelectItem value="__ignore__">Ignorar</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {String(rows[0]?.[i] ?? "—")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {(descIdx < 0 || skipped > 0 || ignoredCols.length > 0 || dupFields.length > 0) && (
              <div className="space-y-2">
                {descIdx < 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>Nenhuma coluna foi mapeada para <strong>Descrição</strong>. Selecione uma para continuar.</AlertDescription>
                  </Alert>
                )}
                {dupFields.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>Campo(s) duplicado(s): {dupFields.join(", ")}. Cada campo deve ser mapeado uma única vez.</AlertDescription>
                  </Alert>
                )}
                {skipped > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{skipped} linha(s) sem descrição serão ignoradas.</AlertDescription>
                  </Alert>
                )}
                {ignoredCols.length > 0 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>Coluna(s) não utilizada(s): {ignoredCols.join(", ")}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {validRows.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Prévia (primeiras 5 linhas)</h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Código</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validRows.slice(0, 5).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.descricao}</TableCell>
                          <TableCell className="text-muted-foreground">{r.categoria || "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{r.code || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={reset}>Cancelar</Button>
            <Button
              disabled={!canImport || dupFields.length > 0 || importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              {importMut.isPending ? "Importando..." : `Importar ${validRows.length} registro(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "success" | "warning" }) {
  const cls = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "";
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
