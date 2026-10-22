import React, { useCallback, useEffect, useState, useRef } from 'react';
import { ArrowDownLeft, Loader2, Package, Save, Trash2, UserCheck, Camera, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabaseClient';
import { uploadEmployeeAvatar, deleteEmployeeAvatarFromStorage } from '@/lib/avatarStorage';
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
  
  // Estado da Foto de Perfil
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [newAvatarFile, setNewAvatarFile] = useState<File | null>(null);
  const [hasRemovedAvatar, setHasRemovedAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setAvatarPreview(null);
      setNewAvatarFile(null);
      setHasRemovedAvatar(false);
      setAssignedEquipments([]);
      setEquipmentLoadError(false);
      return;
    }

    setName(employee.name || '');
    setRole(employee.role || 'Operador');
    setPin(employee.pin || '');
    setEmail(employee.email || '');
    
    // Inicializa a foto atual do funcionário
    const initialAvatar = employee.avatar_url || (employee.avatar && !employee.avatar.includes('ui-avatars.com') ? employee.avatar : null);
    setAvatarPreview(initialAvatar);
    setNewAvatarFile(null);
    setHasRemovedAvatar(false);

    if (isOpen) {
      void loadEmployeeEquipments(employee.id);
    }
  }, [employee, isOpen, loadEmployeeEquipments]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem válido (JPEG, PNG ou WebP).');
      return;
    }

    setNewAvatarFile(file);
    setHasRemovedAvatar(false);
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
  };

  const handleRemoveAvatar = () => {
    setNewAvatarFile(null);
    setAvatarPreview(null);
    setHasRemovedAvatar(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employee || !name.trim()) return;

    if (role === 'Gerente' && !pin.trim()) {
      toast.error('Informe o PIN gerencial para este perfil.');
      return;
    }

    setIsSaving(true);
    const toastId = toast.loading('Salvando alterações...');

    try {
      let finalAvatarUrl = employee.avatar_url;

      // 1. Se removeu ou trocou a foto, exclui a foto antiga do Storage para não acumular lixo
      if (hasRemovedAvatar || newAvatarFile) {
        if (employee.avatar_url) {
          await deleteEmployeeAvatarFromStorage(employee.avatar_url);
        }
      }

      // 2. Se escolheu um novo arquivo, comprime e envia para o Storage
      if (newAvatarFile) {
        toast.loading('Processando e enviando nova foto...', { id: toastId });
        finalAvatarUrl = await uploadEmployeeAvatar(newAvatarFile, employee.id || name.trim());
      } else if (hasRemovedAvatar) {
        finalAvatarUrl = null;
      }

      // 3. Atualiza os dados no Supabase
      const { error } = await supabase
        .from('employees')
        .update({
          name: name.trim(),
          role,
          pin: role === 'Gerente' ? pin : null,
          email: role === 'Gerente' ? email.trim() : null,
          avatar_url: finalAvatarUrl,
        })
        .eq('id', employee.id);

      if (error) throw error;

      toast.success('Perfil atualizado com sucesso!', { id: toastId });
      onEmployeeUpdated();
      onClose();
    } catch (error: any) {
      console.error('Erro ao atualizar funcionário:', error);
      toast.error(`Erro ao atualizar: ${error.message || 'Falha no banco de dados'}`, { id: toastId });
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

      toast.success('Item devolvido com sucesso.');
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

  const initials = employee.name ? employee.name.substring(0, 2).toUpperCase() : 'FT';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
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
            
            {/* Seletor Visual de Foto de Perfil */}
            <div className="flex items-center gap-4 p-3 rounded-2xl bg-secondary/30 dark:bg-white/[0.03] border border-border dark:border-white/10">
              <div 
                onClick={() => !isSaving && fileInputRef.current?.click()}
                className="relative group w-16 h-16 rounded-2xl overflow-hidden border-2 border-dashed border-border dark:border-white/20 hover:border-brand-accent bg-background flex items-center justify-center cursor-pointer transition-lux shrink-0 shadow-sm"
                title="Clique para trocar a foto"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt={name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-brand-accent/10 text-brand-accent flex items-center justify-center font-bold text-base">
                    {initials}
                  </div>
                )}
                
                <div className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="w-4 h-4" />
                </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/*" 
                className="hidden" 
                disabled={isSaving}
              />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground">Foto de Perfil</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {newAvatarFile ? newAvatarFile.name : avatarPreview ? 'Foto personalizada carregada' : 'Sem foto cadastrada'}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-primary hover:underline font-semibold"
                  >
                    Trocar Foto
                  </button>
                  {avatarPreview && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleRemoveAvatar}
                      className="text-xs text-destructive hover:underline font-medium"
                    >
                      Remover Foto
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="employee-name" className="text-xs font-semibold text-brand-ink">
                Nome completo
              </label>
              <Input
                id="employee-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={isSaving}
                className="h-10 rounded-xl bg-background"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-brand-ink">Cargo</label>
                <Select value={role} onValueChange={(value) => setRole(value ?? 'Operador')} disabled={isSaving}>
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
                  disabled={isSaving || role !== 'Gerente'}
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
                  disabled={isSaving}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-10 rounded-xl bg-background"
                />
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              {onDeleteRequest ? (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => onDeleteRequest(employee)}
                  className="flex items-center gap-1.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-xs font-semibold text-destructive transition-all hover:bg-destructive hover:text-white active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir funcionário
                </button>
              ) : <div />}
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 rounded-xl bg-brand-accent px-5 py-2.5 text-xs font-bold text-brand-accent-fg shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 gold-glow"
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
