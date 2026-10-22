import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { UserPlus, Pencil, Ban, CheckCircle2, Package, Trash2, Loader2 } from 'lucide-react';
import EmployeeModal from './EmployeeModal';
import EditEmployeeModal from './EditEmployeeModal';
import EquipmentModal from './EquipmentModal';
import { supabase } from '@/lib/supabaseClient';
import { deleteEmployeeAvatarFromStorage } from '@/lib/avatarStorage';
import { toast } from 'sonner';

export type UserRole = 'operador' | 'gerente' | 'dono';

interface EquipeProps {
  userRole: UserRole;
}

export default function Equipe({ userRole }: EquipeProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [employeesList, setEmployeesList] = useState<any[]>([]);

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
    if (data) {
      const mappedData = data.map(item => ({
        id: item.id,
        name: item.name,
        role: item.role,
        status: item.status,
        pin: item.pin,
        email: item.email,
        avatar_url: item.avatar_url,
        date: new Date(item.created_at).toLocaleDateString('pt-BR'),
        avatar: item.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=D9A45C&color=fff`
      }));
      setEmployeesList(mappedData);
    }
  };

  React.useEffect(() => {
    loadEmployees();
    window.addEventListener('employee-created', loadEmployees);
    return () => window.removeEventListener('employee-created', loadEmployees);
  }, []);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const novoStatus = currentStatus === 'Ativo' ? 'Inativo' : 'Ativo';
    try {
      const { error } = await supabase.from('employees').update({ status: novoStatus }).eq('id', id);
      if (error) throw error;
      toast.success(`Status alterado para ${novoStatus}.`);
      loadEmployees();
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      toast.error('Erro ao atualizar status do funcionário.');
    }
  };

  const handleDeleteEmployee = async () => {
    if (!employeeToDelete) return;

    setIsDeleting(true);
    try {
      // 1. Libera equipamentos que estavam sob posse do funcionário
      const { error: equipError } = await supabase
        .from('equipments')
        .update({ assigned_to: null, status: 'Disponível' })
        .eq('assigned_to', employeeToDelete.id)
        .neq('status', 'Manutenção');

      if (equipError) {
        console.warn('Aviso ao desvincular equipamentos do funcionário excluído:', equipError);
      }

      // 2. Remove a foto de perfil do Storage (se existir)
      await deleteEmployeeAvatarFromStorage(employeeToDelete.avatar_url || employeeToDelete.avatar);

      // 3. Remove o funcionário do banco de dados
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', employeeToDelete.id);

      if (error) throw error;

      toast.success(`Funcionário "${employeeToDelete.name}" excluído com sucesso!`);
      window.dispatchEvent(new CustomEvent('equipment-updated'));
      window.dispatchEvent(new CustomEvent('employee-deleted'));
      setEmployeeToDelete(null);
      await loadEmployees();
    } catch (error: any) {
      console.error('Erro ao excluir funcionário:', error);
      toast.error('Erro ao excluir funcionário. Verifique suas permissões e tente novamente.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (userRole === 'operador') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <Ban className="h-12 w-12 text-brand-muted mb-4" />
        <h2 className="text-xl font-bold text-brand-ink">Acesso Negado</h2>
        <p className="text-brand-muted mt-2">Você não tem permissão para acessar esta área.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      {/* HEADER DA TELA */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Gestão de Equipe</h2>
          <p className="text-muted-foreground text-sm mt-1">Gerencie fotógrafos, operadores e inventário de equipamentos.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsEquipmentModalOpen(true)}
            className="bg-card hover:bg-muted border border-border text-foreground px-4 py-2.5 rounded-full font-semibold transition-all shadow-sm flex items-center gap-2 text-sm cursor-pointer active:scale-95"
          >
            <Package className="h-4 w-4 text-primary" />
            Equipamentos
          </button>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="bg-brand-accent hover:brightness-110 text-brand-accent-fg px-5 py-2.5 rounded-full font-semibold transition-all shadow-sm flex items-center gap-2 text-sm cursor-pointer active:scale-95"
          >
            <UserPlus className="h-4 w-4" />
            Novo Funcionário
          </button>
        </div>
      </div>

      {/* LISTA DE FUNCIONÁRIOS */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">Membros da Operação</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Admissão</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeesList.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-border">
                          <img src={emp.avatar} alt={emp.name} className="w-full h-full object-cover" />
                        </div>
                        <span className="font-medium text-foreground">{emp.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${emp.role === 'Gerente' ? 'bg-brand-accent/10 text-brand-accent' : 'bg-secondary text-muted-foreground'}`}>
                        {emp.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 rounded-full ${emp.status === 'Ativo' ? 'bg-emerald-500' : 'bg-destructive'}`}></div>
                        <span className={`text-sm ${emp.status === 'Ativo' ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {emp.status}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">{emp.date}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingEmployee(emp)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors cursor-pointer"
                          title="Editar Perfil e Equipamentos"
                          aria-label={`Editar perfil de ${emp.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {emp.status === 'Ativo' ? (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(emp.id, emp.status)}
                            className="p-2 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 rounded-full transition-colors cursor-pointer"
                            title="Bloquear Acesso"
                            aria-label={`Bloquear acesso de ${emp.name}`}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(emp.id, emp.status)}
                            className="p-2 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 rounded-full transition-colors cursor-pointer"
                            title="Reativar Acesso"
                            aria-label={`Reativar acesso de ${emp.name}`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEmployeeToDelete(emp)}
                          className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors cursor-pointer"
                          title="Excluir Funcionário"
                          aria-label={`Excluir funcionário ${emp.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      <EditEmployeeModal
        isOpen={!!editingEmployee}
        onClose={() => setEditingEmployee(null)}
        employee={editingEmployee}
        onEmployeeUpdated={loadEmployees}
        onDeleteRequest={(emp) => {
          setEditingEmployee(null);
          setEmployeeToDelete(emp);
        }}
      />

      <EquipmentModal
        isOpen={isEquipmentModalOpen}
        onClose={() => setIsEquipmentModalOpen(false)}
        employees={employeesList}
      />

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      <Dialog open={!!employeeToDelete} onOpenChange={(open) => !open && !isDeleting && setEmployeeToDelete(null)}>
        <DialogContent className="sm:max-w-md border-border bg-brand-surface p-6 shadow-2xl rounded-2xl">
          <DialogHeader className="gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
              <Trash2 className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Excluir Funcionário
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Tem certeza que deseja excluir permanentemente <strong className="text-foreground">{employeeToDelete?.name}</strong> da equipe? 
                Itens sob sua custódia serão liberados e devolvidos ao armário como disponíveis. Esta ação não poderá ser desfeita.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-row justify-end gap-2.5">
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setEmployeeToDelete(null)}
              className="px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-foreground font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDeleteEmployee}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-white font-semibold text-sm shadow-sm transition-all cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isDeleting ? 'Excluindo...' : 'Sim, Excluir'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
