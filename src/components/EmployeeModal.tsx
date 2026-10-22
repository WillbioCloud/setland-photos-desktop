import React, { useState, useRef, useEffect } from 'react';
import { Briefcase, Camera, X, Upload, Loader2, User } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import { uploadEmployeeAvatar } from '@/lib/avatarStorage';
import { toast } from 'sonner';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EmployeeModal({ isOpen, onClose }: EmployeeModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('Operador');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  
  // Estado para o avatar
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Limpa o estado quando o modal fecha ou abre
  useEffect(() => {
    if (!isOpen) {
      setName('');
      setRole('Operador');
      setPin('');
      setEmail('');
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
      }
      setAvatarFile(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem válido (JPEG, PNG ou WebP).');
      return;
    }

    setAvatarFile(file);
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
    }
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
  };

  const handleClearAvatar = () => {
    setAvatarFile(null);
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    const toastId = toast.loading('Cadastrando funcionário...');

    try {
      let uploadedAvatarUrl: string | null = null;

      // Se o usuário selecionou uma foto, comprime e envia para o Storage
      if (avatarFile) {
        toast.loading('Comprimindo e enviando foto de perfil...', { id: toastId });
        uploadedAvatarUrl = await uploadEmployeeAvatar(avatarFile, name.trim());
      }

      const { error } = await supabase.from('employees').insert({
        name: name.trim(),
        role,
        pin: role === 'Gerente' ? pin : null,
        email: role === 'Gerente' ? email.trim() : null,
        status: 'Ativo',
        avatar_url: uploadedAvatarUrl
      });

      if (error) throw error;

      toast.success('Funcionário cadastrado com sucesso!', { id: toastId });
      window.dispatchEvent(new CustomEvent('employee-created'));
      
      onClose();
    } catch (err: any) {
      console.error('Erro ao cadastrar funcionário:', err);
      toast.error(`Erro ao cadastrar: ${err.message || 'Falha no banco de dados'}`, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-lg sm:rounded-[2rem] p-7 shadow-2xl">
        <DialogHeader className="flex flex-col items-center text-center mt-1 mb-2">
          <div className="w-14 h-14 rounded-2xl bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-3 border border-brand-accent/20 shadow-sm gold-glow">
            <Briefcase className="h-7 w-7" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">Novo Funcionário</DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs sm:text-sm mt-1">
            Cadastre um novo membro na operação da Setland.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 pt-1" onSubmit={handleSubmit}>
          
          {/* Seletor Visual de Foto de Perfil */}
          <div className="flex flex-col items-center justify-center gap-2 py-1">
            <div 
              onClick={() => !isSubmitting && fileInputRef.current?.click()}
              className="relative group w-20 h-20 rounded-2xl overflow-hidden border-2 border-dashed border-border dark:border-white/15 hover:border-brand-accent bg-secondary/30 dark:bg-white/[0.03] flex items-center justify-center cursor-pointer transition-lux shadow-sm select-none"
              title="Clique para escolher a foto de perfil"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground group-hover:text-brand-accent transition-colors">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] mt-1 font-medium">Foto</span>
                </div>
              )}
              
              <div className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload className="w-5 h-5" />
              </div>
            </div>

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
              disabled={isSubmitting}
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-primary hover:underline font-semibold"
              >
                {avatarFile ? 'Trocar Foto' : 'Escolher Foto'}
              </button>
              {avatarFile && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleClearAvatar}
                  className="text-xs text-destructive hover:underline font-medium"
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-brand-ink ml-1 block">Nome Completo</label>
            <Input 
              type="text" 
              placeholder="Ex: João Silva"
              required
              disabled={isSubmitting}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl bg-background border-border text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-brand-ink ml-1 block">Cargo</label>
              <Select value={role} onValueChange={setRole} disabled={isSubmitting}>
                <SelectTrigger className="w-full h-11 bg-background border border-border rounded-xl text-foreground focus:ring-brand-accent text-sm">
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operador" className="text-sm">Operador (Fotógrafo)</SelectItem>
                  <SelectItem value="Gerente" className="text-sm">Gerente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-brand-ink ml-1 block">PIN de Acesso</label>
              <Input 
                type="password" 
                maxLength={6}
                placeholder="6 dígitos"
                disabled={isSubmitting || role !== 'Gerente'}
                required={role === 'Gerente'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="h-11 rounded-xl bg-background border-border font-mono tracking-widest text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-brand-ink ml-1 block">
              E-mail <span className="text-brand-muted font-normal">(Opcional, apenas para Gerente)</span>
            </label>
            <Input 
              type="email" 
              placeholder="gerente@setland.com"
              disabled={isSubmitting || role !== 'Gerente'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl bg-background border-border text-sm"
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-xs sm:text-sm border border-transparent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-bold hover:opacity-90 transition-opacity text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 gold-glow disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Cadastrar'
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
