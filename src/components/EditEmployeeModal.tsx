import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, Loader2, Package, Save, Trash2, UserCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface EditEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: any | null;
  onEmployeeUpdated: () => void;
  onDeleteRequest?: (employee: any) => void;
}

export default function EditEmployeeModal({
  isOpen,
  onClose,
  employee,
  onEmployeeUpdated,
  onDeleteRequest,
}: EditEmployeeModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('Operador');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [assignedEquipments, setAssignedEquipments] = useState<any[]>([]);
  const [isLoadingEquipments, setIsLoadingEquipments] = useState(false);
  const [equipmentLoadError, setEquipmentLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [returningEquipmentId, setReturningEquipmentId] = useState<string | null>(null);

  const loadEmployeeEquipments = useCallback(async (employeeId: string) => {
    setIsLoadingEquipments(true);
    setEquipmentLoadError(false);

    try {
      const { data, error } = await supabase
        .from('equipments')
        .select('*')
        .eq('assigned_to', employeeId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignedEquipments(data ?? []);
    } catch (error) {
      console.error('Erro ao carregar itens sob custódia:', error);
      setAssignedEquipments([]);
      setEquipmentLoadError(true);
      toast.error('Não foi possível carregar os itens sob custódia deste funcionário.');
    } finally {
      setIsLoadingEquipments(false);
    }
  }, []);

  useEffect(() => {
    if (!employee) {
      setName('');
      setRole('Operador');
      setPin('');
      setEmail('');
      setAssignedEquipments([]);
      setEquipmentLoadError(false);
      return;
    }

    setName(employee.name || '');
    setRole(employee.role || 'Operador');
    setPin(employee.pin || '');
    setEmail(employee.email || '');

    if (isOpen) {
      void loadEmployeeEquipments(employee.id);
    }
  }, [employee, isOpen, loadEmployeeEquipments]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employee || !name.trim()) return;

    if (role === 'Gerente' && !pin.trim()) {
      toast.error('Informe o PIN gerencial para este perfil.');
      return;
    }

    setIsSaving(true);

    try {
      const { error } = await supabase
        .from('employees')
        .update({
          name: name.trim(),
          role,
          pin: role === 'Gerente' ? pin : null,
          email: role === 'Gerente' ? email.trim() : null,
        })
        .eq('id', employee.id);

      if (error) throw error;

      toast.success('Perfil atualizado com sucesso!');
      onEmployeeUpdated();
      onClose();
    } catch (error) {
      console.error('Erro ao atualizar funcionário:', error);
      toast.error('Erro ao atualizar funcionário. Verifique suas permissões e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReturnEquipment = async (equipment: any) => {
    if (!employee) return;

    setReturningEquipmentId(equipment.id);

    try {
      const nextStatus = equipment.status === 'Manutenção' ? 'Manutenção' : 'Disponível';
      const { error } = await supabase
        .from('equipments')
        .update({ assigned_to: null, status: nextStatus })
        .eq('id', equipment.id);

      if (error) throw error;

      toast.success('Item devolvido.');
      setAssignedEquipments((current) => current.filter((item) => item.id !== equipment.id));
      window.dispatchEvent(new CustomEvent('equipment-updated'));
    } catch (error) {
      console.error('Erro ao devolver equipamento:', error);
      toast.error('Erro ao devolver o item.');
    } finally {
      setReturningEquipmentId(null);
    }
  };

  if (!employee) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden border-border bg-brand-surface p-0 shadow-2xl sm:max-w-2xl sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center gap-3 border-b border-border-dashed bg-brand-surface px-5 py-4 dark:border-white/10 sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 pr-7">
            <DialogTitle className="text-lg font-bold text-foreground">Editar membro da equipe</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Atualize o perfil e confira os itens sob custódia de {employee.name}.
            </DialogDescription>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="employee-name" className="text-xs font-semibold text-brand-ink">
                Nome completo
              </label>
              <Input
                id="employee-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="h-10 rounded-xl bg-background"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-brand-ink">Cargo</label>
                <Select value={role} onValueChange={(value) => setRole(value ?? 'Operador')}>
                  <SelectTrigger aria-label="Cargo do funcionário" className="h-10 w-full rounded-xl bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Operador">Operador (Fotógrafo)</SelectItem>
                    <SelectItem value="Gerente">Gerente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="employee-pin" className="text-xs font-semibold text-brand-ink">
                  PIN gerencial
                </label>
                <Input
                  id="employee-pin"
                  type="password"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="6 dígitos"
                  required={role === 'Gerente'}
                  disabled={role !== 'Gerente'}
                  autoComplete="new-password"
                  className="h-10 rounded-xl bg-background font-mono"
                />
              </div>
            </div>

            {role === 'Gerente' && (
              <div className="space-y-1.5">
                <label htmlFor="employee-email" className="text-xs font-semibold text-brand-ink">
                  E-mail operacional
                </label>
                <Input
                  id="employee-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-10 rounded-xl bg-background"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              {onDeleteRequest ? (
                <button
                  type="button"
                  onClick={() => onDeleteRequest(employee)}
                  className="flex items-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-xs font-semibold text-destructive transition-all hover:bg-destructive hover:text-white active:scale-95 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir funcionário
                </button>
              ) : <div />}
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 rounded-xl bg-brand-accent px-5 py-2.5 text-xs font-bold text-brand-accent-fg shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </form>

          <div className="space-y-3 border-t border-border-dashed pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
                <Package className="h-4 w-4 text-primary" />
                Itens em posse
              </h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                {isLoadingEquipments ? 'Carregando...' : `${assignedEquipments.length} ${assignedEquipments.length === 1 ? 'item' : 'itens'}`}
              </span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="text-xs">Código</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-right text-xs">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingEquipments ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando itens em custódia...
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : equipmentLoadError ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-7 text-center text-xs text-muted-foreground">
                        <div className="flex flex-col items-center gap-3">
                          <span>Não foi possível consultar os itens em custódia.</span>
                          <button
                            type="button"
                            onClick={() => void loadEmployeeEquipments(employee.id)}
                            className="rounded-lg border border-border px-3 py-1.5 font-semibold text-foreground transition-colors hover:bg-muted"
                          >
                            Tentar novamente
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : assignedEquipments.length > 0 ? (
                    assignedEquipments.map((equipment) => (
                      <TableRow key={equipment.id} className="border-b border-border-dashed">
                        <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                          {equipment.tag_code || 'S/N'}
                        </TableCell>
                        <TableCell className="max-w-48 whitespace-normal text-xs font-medium text-foreground">
                          {equipment.name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{equipment.category}</TableCell>
                        <TableCell className="text-right">
                          <button
                            type="button"
                            onClick={() => void handleReturnEquipment(equipment)}
                            disabled={returningEquipmentId === equipment.id}
                            className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Devolver item para o armário"
                          >
                            {returningEquipmentId === equipment.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <ArrowDownLeft className="h-3 w-3" />}
                            Devolver
                          </button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                        Nenhum equipamento ou fantasia atribuído a este funcionário.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
