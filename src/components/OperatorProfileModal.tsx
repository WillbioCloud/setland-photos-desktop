import React, { useState, useEffect, useCallback } from 'react';
import { 
  Camera, 
  Shield, 
  UserCircle, 
  Lock, 
  LogOut, 
  CheckCircle2, 
  Layers, 
  QrCode, 
  Hash, 
  Pencil, 
  Check, 
  X, 
  Loader2, 
  Sparkles,
  ArrowUpRight
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

export type UserRole = 'operador' | 'gerente' | 'dono';

interface OperatorProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  onElevateToAdmin?: () => void;
  onLogout?: () => void;
}

interface PhotographerWithEquipment {
  id: string;
  name: string;
  role: string;
  status: string;
  avatar_url?: string | null;
  email?: string | null;
  equipments: {
    id: string;
    name: string;
    category?: string;
    tag_code?: string | null;
  }[];
}

interface ManagerProfile {
  name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
  userId?: string;
}

export default function OperatorProfileModal({
  isOpen,
  onClose,
  userRole,
  onElevateToAdmin,
  onLogout
}: OperatorProfileModalProps) {
  const [photographers, setPhotographers] = useState<PhotographerWithEquipment[]>([]);
  const [managerProfile, setManagerProfile] = useState<ManagerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Edição de avatar para Gerente / Dono
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (userRole === 'operador') {
        // Carrega somente funcionários com cargo Operador ativo e equipamentos vinculados (excluindo Gerente e Dono)
        const [{ data: empData, error: empErr }, { data: eqData, error: eqErr }] = await Promise.all([
          supabase
            .from('employees')
            .select('*')
            .eq('status', 'Ativo')
            .order('name', { ascending: true }),
          supabase.from('equipments').select('*')
        ]);

        if (empErr) throw empErr;

        const equips = eqData || [];

        // Filtra estritamente funcionários com cargo Operador (garante que Dono e Gerente não apareçam entre os fotógrafos)
        const operatorsOnly = (empData || []).filter((emp: any) => {
          const role = String(emp.role || '').trim().toLowerCase();
          const isExcluded = role === 'dono' || role === 'gerente';
          const isOperator = role === 'operador' || role.includes('operad') || role.includes('fotograf');
          return isOperator && !isExcluded;
        });

        const mapped: PhotographerWithEquipment[] = operatorsOnly.map((emp: any) => {
          const assigned = equips.filter(
            (eq: any) => eq.assigned_to === emp.id || eq.assigned_to === emp.name
          );
          return {
            id: emp.id,
            name: emp.name,
            role: emp.role || 'Operador',
            status: emp.status || 'Ativo',
            avatar_url: emp.avatar_url,
            email: emp.email,
            equipments: assigned.map((eq: any) => ({
              id: eq.id,
              name: eq.name,
              category: eq.category,
              tag_code: eq.tag_code
            }))
          };
        });

        setPhotographers(mapped);
      } else {
        // Carrega perfil executivo do Gerente ou Dono
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: sysUser } = await supabase
            .from('system_users')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          const currentAvatar = sysUser?.avatar_url || user.user_metadata?.avatar_url || '';
          setManagerProfile({
            name: sysUser?.name || user.user_metadata?.name || 'Administrador',
            email: sysUser?.email || user.email || '',
            role: (sysUser?.role || userRole).toUpperCase(),
            avatar_url: currentAvatar,
            userId: user.id
          });
          setAvatarUrlInput(currentAvatar);
        }
      }
    } catch (err: any) {
      console.error('[OperatorProfileModal] Erro ao carregar dados:', err);
      toast.error('Erro ao carregar informações de perfil.');
    } finally {
      setIsLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    if (isOpen) {
      setIsEditingAvatar(false);
      void loadData();
    }
  }, [isOpen, loadData]);

  if (!isOpen) return null;

  const handleSaveAvatar = async () => {
    if (!managerProfile?.userId) return;
    setIsSavingAvatar(true);
    try {
      // 1. Atualiza na tabela system_users
      await supabase
        .from('system_users')
        .update({ avatar_url: avatarUrlInput.trim() })
        .eq('id', managerProfile.userId);

      // 2. Atualiza user_metadata no auth
      await supabase.auth.updateUser({
        data: { avatar_url: avatarUrlInput.trim() }
      });

      setManagerProfile(prev => prev ? { ...prev, avatar_url: avatarUrlInput.trim() } : null);
      setIsEditingAvatar(false);
      toast.success('Foto de perfil atualizada com sucesso!');
    } catch (err) {
      console.error('Erro ao atualizar foto de perfil:', err);
      toast.error('Não foi possível salvar a nova foto.');
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const handleElevate = () => {
    onClose();
    if (onElevateToAdmin) onElevateToAdmin();
  };

  const handleLogoutAction = () => {
    onClose();
    if (onLogout) onLogout();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card dark:bg-[#12141a] border-border dark:border-white/10 sm:max-w-3xl lg:max-w-4xl sm:rounded-[2rem] p-6 max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        
        {/* Cabeçalho */}
        <DialogHeader className="flex flex-row items-center justify-between pb-4 border-b border-border dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-sm ${
              userRole === 'operador'
                ? 'bg-primary/10 text-primary border-primary/20 gold-glow'
                : 'bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-amber-500/10'
            }`}>
              {userRole === 'operador' ? (
                <Camera className="h-6 w-6" />
              ) : (
                <Shield className="h-6 w-6" />
              )}
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                {userRole === 'operador' ? 'Fotógrafos em Operação' : 'Perfil da Gestão'}
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                  userRole === 'operador'
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                }`}>
                  {userRole === 'operador' ? 'Equipe Ativa' : userRole.toUpperCase()}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {userRole === 'operador'
                  ? 'Fotógrafos em campo no Castelo Setland e equipamentos vinculados'
                  : 'Sessão administrativa com privilégios executivos'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Conteúdo Dinâmico por Role */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-4">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Carregando informações...</p>
            </div>
          ) : userRole === 'operador' ? (
            /* Modo Operador: Grid de Fotógrafos com Equipamentos */
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {photographers.map((photog) => {
                  const initials = photog.name.substring(0, 2).toUpperCase();
                  const avatarSrc = photog.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(photog.name)}&background=D9A45C&color=fff`;

                  return (
                    <div
                      key={photog.id}
                      className="rounded-2xl border border-border dark:border-white/10 bg-secondary/20 dark:bg-white/[0.03] p-4 flex flex-col justify-between hover:border-primary/40 transition-lux shadow-sm hover:shadow-md"
                    >
                      <div>
                        {/* Topo do Card: Avatar + Nome + Role */}
                        <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <img
                              src={avatarSrc}
                              alt={photog.name}
                              className="w-12 h-12 rounded-xl object-cover ring-1 ring-border shadow-sm"
                            />
                            {/* Dot verde de status Ativo */}
                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-background" title="Fotógrafo Ativo" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-foreground text-sm truncate" title={photog.name}>
                              {photog.name}
                            </h4>
                            <p className="text-xs text-muted-foreground font-medium mt-0.5">
                              {photog.role}
                            </p>
                          </div>
                        </div>

                        {/* Bloco de Equipamentos Vinculados */}
                        <div className="mt-4 pt-3 border-t border-border/60 space-y-2">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Camera className="w-3 h-3 text-primary" /> Equipamento em Posse
                          </p>

                          {photog.equipments.length > 0 ? (
                            <div className="space-y-1.5">
                              {photog.equipments.map((eq) => (
                                <div
                                  key={eq.id}
                                  className="p-2 rounded-xl bg-background/80 dark:bg-white/[0.04] border border-border/80 text-xs flex items-center justify-between gap-2"
                                >
                                  <span className="font-medium text-foreground truncate" title={eq.name}>
                                    {eq.name}
                                  </span>
                                  {eq.tag_code && (
                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold border border-primary/20 shrink-0">
                                      #{eq.tag_code}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-2 rounded-xl bg-muted/40 border border-dashed border-border text-[11px] text-muted-foreground italic text-center">
                              Nenhuma câmera ou equipamento vinculado
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rodapé do Card */}
                      <div className="mt-3 pt-2 text-[10px] text-muted-foreground/70 flex items-center justify-between font-mono">
                        <span>Status: Operando</span>
                        <span className="text-emerald-500 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Em campo
                        </span>
                      </div>
                    </div>
                  );
                })}

                {photographers.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground flex flex-col items-center">
                    <UserCircle className="w-12 h-12 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium">Nenhum funcionário com cargo de operador ativo cadastrado.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Modo Gerente / Dono: Mini Perfil Executivo */
            <div className="max-w-xl mx-auto py-4">
              <div className="rounded-3xl border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent dark:bg-white/[0.03] p-6 sm:p-8 shadow-xl relative overflow-hidden">
                
                {/* Background glow decorativo */}
                <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
                  {/* Avatar executivo com opção de troca rápida */}
                  <div className="relative group shrink-0">
                    <img
                      src={
                        managerProfile?.avatar_url ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(managerProfile?.name || 'Admin')}&background=D9A45C&color=fff&size=128`
                      }
                      alt="Gestor"
                      className="w-24 h-24 rounded-2xl object-cover ring-2 ring-primary/40 shadow-lg gold-glow"
                    />
                    
                    <button
                      type="button"
                      onClick={() => setIsEditingAvatar(!isEditingAvatar)}
                      className="absolute inset-0 rounded-2xl bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Alterar URL da foto"
                    >
                      <Pencil className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Detalhes do Usuário */}
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                      <h3 className="text-xl sm:text-2xl font-bold text-foreground">
                        {managerProfile?.name || 'Administrador'}
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold tracking-wider bg-primary text-primary-foreground shadow-sm gold-glow">
                        {managerProfile?.role}
                      </span>
                    </div>

                    <p className="text-sm font-mono text-muted-foreground">
                      {managerProfile?.email || 'gestao@setland.com.br'}
                    </p>

                    <div className="pt-2 flex items-center justify-center sm:justify-start gap-2 text-xs text-muted-foreground">
                      <Shield className="w-4 h-4 text-emerald-500" />
                      <span>Sessão executiva segura com acesso total ao sistema.</span>
                    </div>
                  </div>
                </div>

                {/* Caixa expansível para editar URL do Avatar */}
                {isEditingAvatar && (
                  <div className="mt-6 pt-5 border-t border-border space-y-3 animate-in fade-in duration-200">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      URL da Imagem de Perfil
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="url"
                        placeholder="https://exemplo.com/minha-foto.jpg"
                        value={avatarUrlInput}
                        onChange={(e) => setAvatarUrlInput(e.target.value)}
                        className="h-10 text-xs bg-background"
                      />
                      <Button
                        onClick={handleSaveAvatar}
                        disabled={isSavingAvatar || !avatarUrlInput.trim()}
                        className="h-10 px-4 bg-primary text-primary-foreground font-bold text-xs"
                      >
                        {isSavingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Cole um link direto para sua foto (JPEG ou PNG) para atualizar o avatar do painel.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="pt-4 border-t border-border dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          {userRole === 'operador' ? (
            <>
              <button
                type="button"
                onClick={handleElevate}
                className="text-xs text-primary hover:underline font-semibold flex items-center gap-1.5 order-2 sm:order-1"
              >
                <Lock className="w-3.5 h-3.5" />
                Elevar para Acesso Gerencial (Gerente / Dono)
              </button>

              <Button
                variant="outline"
                onClick={onClose}
                className="rounded-xl h-10 text-xs px-6 border-border order-1 sm:order-2 w-full sm:w-auto"
              >
                Fechar
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleLogoutAction}
                className="text-xs text-rose-500 hover:text-rose-600 hover:underline font-semibold flex items-center gap-1.5 order-2 sm:order-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                Encerrar Sessão Gerencial (Voltar p/ Operador)
              </button>

              <Button
                variant="outline"
                onClick={onClose}
                className="rounded-xl h-10 text-xs px-6 border-border order-1 sm:order-2 w-full sm:w-auto"
              >
                Dispensar
              </Button>
            </>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
