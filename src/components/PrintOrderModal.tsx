import React, { useState, useEffect, useCallback } from 'react';
import { 
  Printer, 
  CheckCircle2, 
  RotateCw, 
  CheckSquare, 
  Square, 
  Loader2, 
  AlertTriangle, 
  RefreshCw, 
  Sparkles, 
  Sliders, 
  Image as ImageIcon, 
  Layers, 
  Play,
  Check,
  X
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface PrintPhotoItem {
  id: string | number;
  original_name: string;
  local_original_path?: string;
  preview_url?: string;
}

interface PrintOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  photos: PrintPhotoItem[];
}

export default function PrintOrderModal({ isOpen, onClose, clientName, photos }: PrintOrderModalProps) {
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<(string | number)[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);
  
  // Configurações de Impressão
  const [copies, setCopies] = useState<number>(1);
  const [paperSize, setPaperSize] = useState<string>('15x21');
  const [orientation, setOrientation] = useState<string>('auto');
  const [finish, setFinish] = useState<string>('glossy');
  
  // Orientação detectada por miniatura (naturalWidth > naturalHeight)
  const [photoOrientations, setPhotoOrientations] = useState<Record<string | number, 'landscape' | 'portrait'>>({});

  // Status do Spooler / Progresso
  const [isPrinting, setIsPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState<{ current: number; total: number; message: string; percent: number } | null>(null);

  // Busca as impressoras instaladas no Windows via Electron
  const fetchPrinters = useCallback(async () => {
    setIsLoadingPrinters(true);
    try {
      if (window.electronAPI && window.electronAPI.getPrinters) {
        const list = await window.electronAPI.getPrinters();
        setPrinters(list || []);

        // Auto-seleciona DNP / RX1 se existir, ou padrão do Windows, ou primeira da lista
        const dnp = list.find((p: any) => 
          p.name?.toLowerCase().includes('dnp') || p.name?.toLowerCase().includes('rx1')
        );
        const defaultPrinter = list.find((p: any) => p.isDefault);
        const preferred = dnp?.name || defaultPrinter?.name || list[0]?.name || '';

        setSelectedPrinter(prev => {
          if (prev && list.some((p: any) => p.name === prev)) return prev;
          return preferred;
        });
      } else {
        setPrinters([]);
      }
    } catch (err) {
      console.error('Erro ao listar impressoras:', err);
    } finally {
      setIsLoadingPrinters(false);
    }
  }, []);

  // Inicializa o modal ao abrir
  useEffect(() => {
    if (isOpen) {
      setSelectedPhotoIds(photos.map(p => p.id));
      setIsPrinting(false);
      setPrintProgress(null);
      void fetchPrinters();
    }
  }, [isOpen, photos, fetchPrinters]);

  if (!isOpen) return null;

  const toggleSelectPhoto = (id: string | number) => {
    if (isPrinting) return;
    setSelectedPhotoIds(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (isPrinting) return;
    if (selectedPhotoIds.length === photos.length) {
      setSelectedPhotoIds([]);
    } else {
      setSelectedPhotoIds(photos.map(p => p.id));
    }
  };

  const handleImageLoad = (photoId: string | number, e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    const isLandscape = naturalWidth > naturalHeight;
    setPhotoOrientations(prev => ({
      ...prev,
      [photoId]: isLandscape ? 'landscape' : 'portrait'
    }));
  };

  // Executa o envio para o driver térmico
  const executePrinting = async (targetPhotos: PrintPhotoItem[], label: string) => {
    if (targetPhotos.length === 0) {
      toast.error("Nenhuma foto selecionada para impressão.");
      return;
    }

    setIsPrinting(true);
    const totalJobs = targetPhotos.length * copies;
    
    setPrintProgress({
      current: 1,
      total: totalJobs,
      message: `Enviando 1 de ${totalJobs} para o driver...`,
      percent: 25
    });

    const toastId = toast.loading(`Enviando ${label} para o driver térmico (${copies}x cópias)...`);

    try {
      if (window.electronAPI && window.electronAPI.printPhotos) {
        setPrintProgress({
          current: Math.ceil(totalJobs / 2),
          total: totalJobs,
          message: `Processando fila no spooler térmico...`,
          percent: 65
        });

        const result = await window.electronAPI.printPhotos({
          photos: targetPhotos,
          printerName: selectedPrinter,
          copies,
          orientation,
          paperSize,
          finish
        });

        setPrintProgress({
          current: totalJobs,
          total: totalJobs,
          message: `Impressão enviada com sucesso!`,
          percent: 100
        });

        if (result.success) {
          toast.success(`${result.count} impressão(ões) despachada(s) para [${result.printerUsed}]!`, { 
            id: toastId,
            description: `Formato: ${paperSize} cm • Acabamento: ${finish === 'glossy' ? 'Brilhante' : 'Fosco'}`
          });
          onClose();
        } else {
          toast.warning(result.message || "Aviso no spooler de impressão.", { id: toastId });
        }
      } else {
        // Fallback simulado para navegador ou dev sem bridge
        setPrintProgress({
          current: totalJobs,
          total: totalJobs,
          message: `Simulação concluída!`,
          percent: 100
        });
        await new Promise(resolve => setTimeout(resolve, 1400));
        toast.success(`${targetPhotos.length * copies} impressão(ões) realizada(s) em modo simulado!`, { id: toastId });
        onClose();
      }
    } catch (err: any) {
      console.error('Erro na impressão:', err);
      toast.error("Falha ao comunicar com o driver da impressora.", { id: toastId });
    } finally {
      setIsPrinting(false);
      setPrintProgress(null);
    }
  };

  const handlePrintQueue = async () => {
    const photosToPrint = photos.filter(p => selectedPhotoIds.includes(p.id));
    await executePrinting(photosToPrint, `${photosToPrint.length} foto(s)`);
  };

  const handlePrintSingle = async (photo: PrintPhotoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    await executePrinting([photo], `"${photo.original_name}"`);
  };

  const totalPrintsCount = selectedPhotoIds.length * copies;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isPrinting && onClose()}>
      <DialogContent className="bg-card dark:bg-[#12141a] border-border dark:border-white/10 sm:max-w-4xl lg:max-w-5xl sm:rounded-[2rem] p-5 sm:p-7 max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        
        {/* Cabeçalho */}
        <DialogHeader className="flex flex-row items-center justify-between pb-4 border-b border-border dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-sm gold-glow">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
                Painel de Impressão Térmica
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                  DNP / RX1
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Cliente: <strong className="text-foreground">{clientName}</strong> • {photos.length} {photos.length === 1 ? 'foto selecionada' : 'fotos selecionadas'} para impressão
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Barra de Configurações Técnicas da Impressão */}
        <div className="py-3.5 border-b border-border dark:border-white/10 bg-secondary/20 dark:bg-white/[0.02] -mx-5 sm:-mx-7 px-5 sm:px-7 space-y-3 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            
            {/* Seletor de Impressora Real */}
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-primary" /> Impressora
                </label>
                <button
                  type="button"
                  onClick={fetchPrinters}
                  disabled={isLoadingPrinters || isPrinting}
                  className="text-[10px] text-primary hover:underline flex items-center gap-1 font-medium disabled:opacity-50"
                  title="Atualizar lista de impressoras"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingPrinters ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>

              <Select value={selectedPrinter} onValueChange={setSelectedPrinter} disabled={isPrinting || printers.length === 0}>
                <SelectTrigger className="w-full h-9 bg-background border-border text-xs">
                  <SelectValue placeholder={isLoadingPrinters ? "Carregando..." : printers.length === 0 ? "Nenhuma impressora" : "Selecione a impressora"} />
                </SelectTrigger>
                <SelectContent>
                  {printers.map((p, idx) => {
                    const isDNP = p.name.toLowerCase().includes('dnp') || p.name.toLowerCase().includes('rx1');
                    return (
                      <SelectItem key={idx} value={p.name} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate max-w-[170px]">{p.name}</span>
                          {p.isDefault && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/20">
                              Padrão
                            </span>
                          )}
                          {isDNP && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/20">
                              DNP
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Formato / Tamanho do Papel */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" /> Tamanho do Papel
              </label>
              <Select value={paperSize} onValueChange={setPaperSize} disabled={isPrinting}>
                <SelectTrigger className="w-full h-9 bg-background border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15x21" className="text-xs font-medium">15x21 cm (Padrão Castelo)</SelectItem>
                  <SelectItem value="10x15" className="text-xs font-medium">10x15 cm</SelectItem>
                  <SelectItem value="20x25" className="text-xs font-medium">20x25 cm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Orientação */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-primary" /> Orientação
              </label>
              <Select value={orientation} onValueChange={setOrientation} disabled={isPrinting}>
                <SelectTrigger className="w-full h-9 bg-background border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs font-medium">Automática por Foto</SelectItem>
                  <SelectItem value="landscape" className="text-xs font-medium">Forçar Paisagem</SelectItem>
                  <SelectItem value="portrait" className="text-xs font-medium">Forçar Retrato</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cópias por Foto e Acabamento */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-primary" /> Cópias & Acabamento
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Cópias Pills */}
                <div className="flex bg-background border border-border rounded-lg p-0.5 shrink-0">
                  {[1, 2, 3].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isPrinting}
                      onClick={() => setCopies(num)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                        copies === num
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {num}x
                    </button>
                  ))}
                </div>

                {/* Acabamento */}
                <Select value={finish} onValueChange={setFinish} disabled={isPrinting}>
                  <SelectTrigger className="flex-1 h-9 bg-background border-border text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="glossy" className="text-xs font-medium">Brilhante (Glossy)</SelectItem>
                    <SelectItem value="matte" className="text-xs font-medium">Fosco (Matte)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

          </div>

          {/* Aviso claro caso nenhuma impressora física esteja conectada (Modo Simulado de Teste) */}
          {printers.length === 0 && !isLoadingPrinters && (
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-medium animate-in fade-in duration-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                <strong>Modo Simulado de Teste:</strong> Nenhuma impressora física detectada no Windows. O envio será concluído com simulação bem-sucedida.
              </span>
            </div>
          )}
        </div>

        {/* Barra de Ações Rápidas da Grade */}
        <div className="flex items-center justify-between py-2.5 shrink-0">
          <button 
            type="button"
            onClick={toggleSelectAll}
            disabled={isPrinting}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {selectedPhotoIds.length === photos.length ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            Selecionar Todas as Fotos
          </button>
          
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Selecionadas:</span>
            <span className="font-mono font-bold text-foreground bg-muted px-2.5 py-0.5 rounded-full border border-border">
              {selectedPhotoIds.length} de {photos.length}
            </span>
            <span className="text-muted-foreground">• Total de impressões:</span>
            <span className="font-mono font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
              {totalPrintsCount} {totalPrintsCount === 1 ? 'cópia' : 'cópias'}
            </span>
          </div>
        </div>

        {/* Grade Visual de Miniaturas com Feedback Real */}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-2 pr-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {photos.map((photo) => {
              const isSelected = selectedPhotoIds.includes(photo.id);
              const detected = photoOrientations[photo.id];
              const effectiveOrientation = orientation === 'auto'
                ? (detected === 'portrait' ? 'Retrato' : 'Paisagem')
                : (orientation === 'landscape' ? 'Forçado Paisagem' : 'Forçado Retrato');

              return (
                <div 
                  key={photo.id}
                  onClick={() => toggleSelectPhoto(photo.id)}
                  className={`group relative rounded-2xl overflow-hidden bg-muted border cursor-pointer transition-lux select-none flex flex-col ${
                    isSelected 
                      ? 'border-primary shadow-md ring-1 ring-primary/50' 
                      : 'border-border opacity-40 grayscale hover:opacity-70'
                  }`}
                >
                  {/* Container da Imagem */}
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
                    <img 
                      src={photo.local_original_path || photo.preview_url} 
                      alt={photo.original_name}
                      onLoad={(e) => handleImageLoad(photo.id, e)}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                    />
                    
                    {/* Badge de Seleção no Canto Superior Esquerdo */}
                    <div className="absolute top-2 left-2 z-10">
                      {isSelected ? (
                        <div className="bg-primary text-primary-foreground rounded-full p-1 shadow-md gold-glow">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="bg-black/50 backdrop-blur-sm text-white/70 rounded-full p-1 border border-white/20">
                          <div className="w-3.5 h-3.5 rounded-full border border-white/60"></div>
                        </div>
                      )}
                    </div>

                    {/* Badge de Orientação Detectada no Canto Superior Direito */}
                    <div className="absolute top-2 right-2 z-10">
                      <span className="inline-flex items-center gap-1 bg-black/70 backdrop-blur-md px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white/95 border border-white/10 shadow-sm">
                        <RotateCw className="w-2.5 h-2.5 text-primary" />
                        {effectiveOrientation}
                      </span>
                    </div>

                    {/* Botão de Impressão Rápida Individual no Hover */}
                    <button
                      type="button"
                      disabled={isPrinting}
                      onClick={(e) => handlePrintSingle(photo, e)}
                      className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 shadow-xl gold-glow"
                      title="Imprimir somente esta foto agora"
                    >
                      <Play className="w-4 h-4 ml-0.5 fill-current" />
                    </button>
                  </div>

                  {/* Informações da Foto */}
                  <div className="p-2 bg-card dark:bg-[#161922] border-t border-border flex items-center justify-between gap-1">
                    <span className="text-[11px] font-medium text-foreground truncate max-w-[110px]" title={photo.original_name}>
                      {photo.original_name}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-primary shrink-0">
                      {paperSize}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Barra de Status do Spooler de Impressão */}
        {printProgress && (
          <div className="my-2 p-3 rounded-xl bg-primary/10 border border-primary/20 space-y-1.5 animate-in fade-in duration-200 shrink-0">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                {printProgress.message}
              </span>
              <span className="font-mono font-bold text-primary">{printProgress.percent}%</span>
            </div>
            <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-primary h-full transition-all duration-300 rounded-full"
                style={{ width: `${printProgress.percent}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Rodapé do Modal */}
        <div className="pt-4 border-t border-border dark:border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="truncate max-w-[320px] sm:max-w-md">
              Spooler direto: O arquivo é enviado diretamente ao driver da impressora.
            </span>
          </div>

          <div className="flex gap-2.5">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isPrinting} 
              className="rounded-xl h-10 text-xs px-4 border-border"
            >
              Dispensar
            </Button>

            <Button 
              onClick={handlePrintQueue} 
              disabled={isPrinting || selectedPhotoIds.length === 0}
              className="bg-primary text-primary-foreground hover:opacity-90 rounded-xl h-10 text-xs font-bold px-6 shadow-md min-w-[200px] gold-glow"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Imprimindo...
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir ({totalPrintsCount} {totalPrintsCount === 1 ? 'foto' : 'fotos'})
                </>
              )}
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
