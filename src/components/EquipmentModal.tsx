import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Package, Plus, Search, UserCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface EmployeeOption {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
}

interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  tag_code: string | null;
  assigned_to: string | null;
  status: string | null;
  employees?: { name: string } | null;
}

interface EquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: EmployeeOption[];
}

export default function EquipmentModal({ isOpen, onClose, employees }: EquipmentModalProps) {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Câmera');
  const [tagCode, setTagCode] = useState('');
  const [assignedTo, setAssignedTo] = useState('none');
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadEquipments = useCallback(async () => {
    setIsLoadingItems(true);
    setLoadError(false);

    try {
      const { data, error } = await supabase
        .from('equipments')
        .select('*, employees(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const equipment = (data ?? []) as EquipmentItem[];
      setItems(equipment);
      setTransferTargets(Object.fromEntries(
        equipment.map((item) => [item.id, item.assigned_to ?? 'none'])
      ));
    } catch (error) {
      console.error('Erro ao carregar inventário de equipamentos:', error);
      setItems([]);
      setLoadError(true);
      toast.error('Não foi possível carregar o inventário de equipamentos.');
    } finally {
      setIsLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    setIsAdding(false);
    setSearchTerm('');
    void loadEquipments();
  }, [isOpen, loadEquipments]);

  useEffect(() => {
    if (!isOpen) return;

    const refreshInventory = () => {
      void loadEquipments();
    };

    window.addEventListener('equipment-updated', refreshInventory);
    return () => window.removeEventListener('equipment-updated', refreshInventory);
  }, [isOpen, loadEquipments]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    if (!normalizedSearch) return items;

    return items.filter((item) => {
      const searchableText = [item.name, item.tag_code, item.category]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchableText.includes(normalizedSearch);
    });
  }, [items, searchTerm]);

  const notifyInventoryChanged = () => {
    window.dispatchEvent(new CustomEvent('equipment-updated'));
  };

  const handleCreateItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsSaving(true);
    const assignedId = assignedTo === 'none' ? null : assignedTo;

    try {
      const { error } = await supabase.from('equipments').insert({
        name: trimmedName,
        category,
        tag_code: tagCode.trim() || null,
        assigned_to: assignedId,
        status: assignedId ? 'Em Uso' : 'Disponível',
      });

      if (error) throw error;

      toast.success('Item adicionado ao patrimônio!');
      setName('');
      setTagCode('');
      setAssignedTo('none');
      setIsAdding(false);
      notifyInventoryChanged();
    } catch (error) {
      console.error('Erro ao cadastrar equipamento:', error);
      toast.error('Erro ao cadastrar equipamento. Verifique suas permissões e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTransfer = async (item: EquipmentItem) => {
    const target = transferTargets[item.id] ?? item.assigned_to ?? 'none';
    const currentCustodian = item.assigned_to ?? 'none';
    if (target === currentCustodian) return;

    const assignedId = target === 'none' ? null : target;
    if (item.status === 'Manutenção' && assignedId) {
      toast.error('Um item em manutenção não pode ser entregue à equipe.');
      return;
    }

    setPendingItemId(item.id);

    try {
      const nextStatus = item.status === 'Manutenção'
        ? 'Manutenção'
        : assignedId ? 'Em Uso' : 'Disponível';
      const { error } = await supabase
        .from('equipments')
        .update({ assigned_to: assignedId, status: nextStatus })
        .eq('id', item.id);

      if (error) throw error;

      const newCustodian = employees.find((employee) => employee.id === assignedId);
      setItems((current) => current.map((existing) => existing.id === item.id
        ? {
            ...existing,
            assigned_to: assignedId,
            status: nextStatus,
            employees: newCustodian ? { name: newCustodian.name } : null,
          }
        : existing));
      setTransferTargets((current) => ({ ...current, [item.id]: target }));

      toast.success(assignedId
        ? item.assigned_to ? 'Custódia transferida com sucesso!' : 'Item atribuído à equipe.'
        : 'Item devolvido ao inventário.');
      notifyInventoryChanged();
    } catch (error) {
      console.error('Erro ao transferir equipamento:', error);
      toast.error('Erro ao atualizar a custódia do item.');
    } finally {
      setPendingItemId(null);
    }
  };

  const handleUnassign = async (item: EquipmentItem) => {
    setPendingItemId(item.id);

    try {
      const nextStatus = item.status === 'Manutenção' ? 'Manutenção' : 'Disponível';
      const { error } = await supabase
        .from('equipments')
        .update({ assigned_to: null, status: nextStatus })
        .eq('id', item.id);

      if (error) throw error;

      setItems((current) => current.map((existing) => existing.id === item.id
        ? { ...existing, assigned_to: null, status: nextStatus, employees: null }
        : existing));
      setTransferTargets((current) => ({ ...current, [item.id]: 'none' }));
      toast.success('Item devolvido ao inventário.');
      notifyInventoryChanged();
    } catch (error) {
      console.error('Erro ao devolver equipamento:', error);
      toast.error('Erro ao devolver o equipamento.');
    } finally {
      setPendingItemId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] flex-col overflow-hidden border-border bg-brand-surface p-0 shadow-2xl sm:max-w-4xl sm:rounded-[2rem]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-dashed bg-brand-surface px-4 py-4 dark:border-white/10 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-bold text-foreground sm:text-lg">
                Inventário &amp; Equipamentos
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                Câmeras, lentes, baterias e fantasias sob custódia da equipe.
              </DialogDescription>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsAdding((current) => !current)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-brand-accent px-3.5 text-xs font-semibold text-brand-accent-fg shadow-sm transition-all hover:opacity-90 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{isAdding ? 'Ver Lista' : 'Novo Equipamento'}</span>
              <span className="sr-only sm:hidden">{isAdding ? 'Ver Lista' : 'Novo Equipamento'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar inventário"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {isAdding ? (
            <form
              onSubmit={handleCreateItem}
              className="mx-auto max-w-xl space-y-4 rounded-2xl border border-border bg-background/50 p-4 sm:p-5"
            >
              <div>
                <h3 className="text-sm font-semibold text-foreground">Cadastrar item no patrimônio</h3>
                <p className="mt-1 text-xs text-muted-foreground">Identifique o item e registre sua primeira custódia.</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="equipment-name" className="text-xs font-medium text-brand-ink">
                  Nome do equipamento / fantasia
                </label>
                <Input
                  id="equipment-name"
                  placeholder="Ex.: Câmera Canon EOS R6 ou Fantasia Arqueiro Real"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className="h-10 rounded-xl bg-background"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-brand-ink">Categoria</label>
                  <Select value={category} onValueChange={(value) => setCategory(value ?? 'Câmera')}>
                    <SelectTrigger aria-label="Categoria do equipamento" className="h-10 w-full rounded-xl bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Câmera">Câmera</SelectItem>
                      <SelectItem value="Lente">Lente</SelectItem>
                      <SelectItem value="Fantasia">Fantasia</SelectItem>
                      <SelectItem value="Acessório">Acessório</SelectItem>
                      <SelectItem value="Rádio/Bateria">Rádio / Bateria</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="equipment-tag" className="text-xs font-medium text-brand-ink">
                    Etiqueta / serial / patrimônio
                  </label>
                  <Input
                    id="equipment-tag"
                    placeholder="Ex.: CAM-01 ou FAN-04"
                    value={tagCode}
                    onChange={(event) => setTagCode(event.target.value)}
                    className="h-10 rounded-xl bg-background font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-brand-ink">Entregar sob custódia de</label>
                <Select value={assignedTo} onValueChange={(value) => setAssignedTo(value ?? 'none')}>
                  <SelectTrigger aria-label="Funcionário responsável pela custódia inicial" className="h-10 w-full rounded-xl bg-background">
                    <SelectValue placeholder="Selecione o operador" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (disponível no armário)</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name} {employee.role ? `(${employee.role})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-xl bg-brand-accent px-5 py-2 text-xs font-bold text-brand-accent-fg shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isSaving ? 'Salvando...' : 'Cadastrar item'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label="Buscar equipamentos"
                  placeholder="Buscar por item, categoria ou código de patrimônio..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="h-10 rounded-xl bg-background pl-10 text-xs font-medium"
                />
              </div>

              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-xs">Código</TableHead>
                      <TableHead className="text-xs">Equipamento / Fantasia</TableHead>
                      <TableHead className="text-xs">Categoria</TableHead>
                      <TableHead className="text-xs">Custódia atual</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-right text-xs">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingItems ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Carregando inventário...
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : loadError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                          <div className="flex flex-col items-center gap-3">
                            <span>Não foi possível consultar o inventário. Verifique o acesso e tente novamente.</span>
                            <button
                              type="button"
                              onClick={() => void loadEquipments()}
                              className="rounded-lg border border-border px-3 py-1.5 font-semibold text-foreground transition-colors hover:bg-muted"
                            >
                              Tentar novamente
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredItems.length > 0 ? (
                      filteredItems.map((item) => {
                        const assignedEmployee = employees.find((employee) => employee.id === item.assigned_to);
                        const custodianName = item.employees?.name ?? assignedEmployee?.name;
                        const currentTarget = item.assigned_to ?? 'none';
                        const selectedTarget = transferTargets[item.id] ?? currentTarget;
                        const status = item.status || (item.assigned_to ? 'Em Uso' : 'Disponível');
                        const isPending = pendingItemId === item.id;

                        return (
                          <TableRow key={item.id} className="border-b border-border-dashed">
                            <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                              {item.tag_code || 'S/N'}
                            </TableCell>
                            <TableCell className="max-w-52 whitespace-normal text-xs font-medium text-foreground">
                              {item.name}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.category}</TableCell>
                            <TableCell className="text-xs">
                              {custodianName ? (
                                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                  <UserCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  {custodianName}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/70 italic">Armário / Livre</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                status === 'Em Uso'
                                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                  : status === 'Manutenção'
                                    ? 'border-destructive/20 bg-destructive/10 text-destructive'
                                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              }`}>
                                {status}
                              </span>
                            </TableCell>
                            <TableCell className="min-w-64 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Select
                                  value={selectedTarget}
                                  onValueChange={(value) => setTransferTargets((current) => ({ ...current, [item.id]: value ?? 'none' }))}
                                  disabled={isPending || status === 'Manutenção'}
                                >
                                  <SelectTrigger
                                    aria-label={`Transferir ${item.name} para outro funcionário`}
                                    className="h-8 w-36 rounded-lg bg-background text-[11px]"
                                  >
                                    <SelectValue placeholder="Transferir para" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Armário / Livre</SelectItem>
                                    {employees.map((employee) => (
                                      <SelectItem key={employee.id} value={employee.id}>
                                        {employee.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <button
                                  type="button"
                                  onClick={() => void handleTransfer(item)}
                                  disabled={isPending || selectedTarget === currentTarget || status === 'Manutenção'}
                                  aria-label={`Aplicar nova custódia para ${item.name}`}
                                  title="Aplicar transferência"
                                  className="flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                                  <span>Aplicar</span>
                                </button>
                                {item.assigned_to && (
                                  <button
                                    type="button"
                                    onClick={() => void handleUnassign(item)}
                                    disabled={isPending}
                                    className="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Devolver
                                  </button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                          {items.length === 0
                            ? 'Nenhum equipamento cadastrado.'
                            : 'Nenhum equipamento corresponde à busca.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
