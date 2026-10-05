import React from 'react';
import { PackagePlus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface PackageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PackageModal({ isOpen, onClose }: PackageModalProps) {
  const [name, setName] = React.useState('');
  const [category, setCategory] = React.useState('Avulsa');
  const [price, setPrice] = React.useState('');
  const [reqPrinted, setReqPrinted] = React.useState('0');
  const [reqDigital, setReqDigital] = React.useState('0');
  const [description, setDescription] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('packages').insert({
      name,
      category,
      price: parseFloat(price),
      req_printed: parseInt(reqPrinted, 10) || 0,
      req_digital: parseInt(reqDigital, 10) || 0,
      description,
      active: true
    });

    if (error) {
      toast.error('Erro ao criar pacote');
      return;
    }

    toast.success('Pacote criado com sucesso!');
    window.dispatchEvent(new CustomEvent('package-created'));
    
    setName('');
    setCategory('Avulsa');
    setPrice('');
    setReqPrinted('0');
    setReqDigital('0');
    setDescription('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-lg sm:rounded-[2rem] p-8">
        <DialogHeader className="flex flex-col items-center text-center mt-2 mb-4">
          <div className="w-16 h-16 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5 border border-brand-accent/20">
            <PackagePlus className="h-8 w-8" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">Novo Pacote</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm mt-2">
            Crie um novo produto para ser vendido no Frente de Caixa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">Nome do Pacote</label>
            <Input 
              type="text" 
              placeholder="Ex: Foto Impressa Extra"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl bg-background border-border"
            />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">Categoria</label>
              <div className="relative">
                <select 
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-11 bg-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent transition-all text-sm appearance-none cursor-pointer"
                >
                  <option value="Avulsa">Avulsa</option>
                  <option value="Combo">Combo</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-brand-muted">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">Preço (R$)</label>
              <Input 
                type="number" 
                step="0.01"
                placeholder="0.00"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-11 rounded-xl bg-background border-border font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">Exige Impressas</label>
              <Input 
                type="number" 
                placeholder="0"
                value={reqPrinted}
                onChange={(e) => setReqPrinted(e.target.value)}
                className="h-11 rounded-xl bg-background border-border font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-brand-ink ml-1 block">Exige Digitais</label>
              <Input 
                type="number" 
                placeholder="0"
                value={reqDigital}
                onChange={(e) => setReqDigital(e.target.value)}
                className="h-11 rounded-xl bg-background border-border font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-brand-ink ml-1 block">Descrição do Pacote</label>
            <textarea 
              rows={3}
              placeholder="O que está incluso neste pacote?"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent transition-all text-sm resize-none"
            />
          </div>

          <div className="pt-5 flex gap-3">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-sm border border-transparent"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="flex-1 py-3 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm shadow-sm"
            >
              Salvar Pacote
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
