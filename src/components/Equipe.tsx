import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { UserPlus, Pencil, Ban, CheckCircle2 } from 'lucide-react';
import EmployeeModal from './EmployeeModal';
import { supabase } from '@/lib/supabaseClient';

export type UserRole = 'operador' | 'gerente' | 'dono';

interface EquipeProps {
  userRole: UserRole;
}

export default function Equipe({ userRole }: EquipeProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [employeesList, setEmployeesList] = useState<any[]>([]);

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
    if (data) {
      const mappedData = data.map(item => ({
        id: item.id,
        name: item.name,
        role: item.role,
        status: item.status,
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
    await supabase.from('employees').update({ status: novoStatus }).eq('id', id);
    loadEmployees();
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
          <p className="text-muted-foreground text-sm mt-1">Gerencie fotógrafos, operadores e acessos ao sistema.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-accent hover:brightness-110 text-brand-accent-fg px-5 py-2.5 rounded-full font-semibold transition-all shadow-sm flex items-center gap-2 text-sm"
        >
          <UserPlus className="h-4 w-4" />
          Novo Funcionário
        </button>
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
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full transition-colors" title="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        {emp.status === 'Ativo' ? (
                          <button onClick={() => handleToggleStatus(emp.id, emp.status)} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors" title="Bloquear Acesso">
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : (
                          <button onClick={() => handleToggleStatus(emp.id, emp.status)} className="p-2 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 rounded-full transition-colors" title="Reativar">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
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
    </div>
  );
}
