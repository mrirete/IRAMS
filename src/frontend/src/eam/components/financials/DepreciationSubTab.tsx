import React, { useState } from 'react';
import { DollarSign, BookOpen, Plus, ChevronRight, ChevronLeft, Table, AlertCircle, Trash2, X, RotateCcw } from 'lucide-react';
import { Asset } from '../../types';
import { FinOpsService, AssetFinancial, DepreciationBook, DepreciationScheduleItem, RecapitalizationResult } from '../../services/FinOpsService';
import { CapitalEventModal } from '../modals/CapitalEventModal';

interface DepreciationProps {
    asset: Asset;
    financialRecord: AssetFinancial | null;
    books: DepreciationBook[];
    saving: boolean;
    setSaving: (v: boolean) => void;
    onCapitalize: (cost: number, salvage: number, lifeYears: number, date: string) => void;
    onAddBook: (bookType: string, method: string) => void;
    onDeleteBook: (bookId: string, bookType: string) => void;
    onReload: () => void;
    onReset: () => void;
}

export const DepreciationSubTab: React.FC<DepreciationProps> = ({
    asset, financialRecord, books, saving, setSaving,
    onCapitalize, onAddBook, onDeleteBook, onReload, onReset
}) => {
    // Local view state
    const [viewMode, setViewMode] = useState<'LIST' | 'LEDGER'>('LIST');
    const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
    const [schedule, setSchedule] = useState<DepreciationScheduleItem[]>([]);
    const [showCapitalizeForm, setShowCapitalizeForm] = useState(false);
    const [showAddBookModal, setShowAddBookModal] = useState(false);
    const [showCapitalEventModal, setShowCapitalEventModal] = useState(false);

    // Capitalization form
    const [capCost, setCapCost] = useState<number>(asset.purchasePrice || 0);
    const [capSalvage, setCapSalvage] = useState<number>(0);
    const [capLifeYears, setCapLifeYears] = useState<number>(5);
    const [capDate, setCapDate] = useState(new Date().toISOString().split('T')[0]);

    // Add book form
    const [newBookType, setNewBookType] = useState<'CORPORATE' | 'TAX' | 'TECHNICAL' | 'IFRS'>('TAX');
    const [newBookMethod, setNewBookMethod] = useState<'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION' | 'SUM_OF_YEARS_DIGITS'>('STRAIGHT_LINE');

    const selectedBook = books.find(b => b.id === selectedBookId);

    const handleViewLedger = (bookId: string) => {
        setSelectedBookId(bookId);
        const book = books.find(b => b.id === bookId);
        if (book && financialRecord) {
            const sched = FinOpsService.calculateDepreciationSchedule(book, financialRecord);
            setSchedule(sched);
        }
        setViewMode('LEDGER');
    };

    const ALL_BOOK_TYPES = [
        { value: 'CORPORATE', label: 'Corporate (GAAP)' },
        { value: 'TAX', label: 'Tax' },
        { value: 'TECHNICAL', label: 'Technical (Internal)' },
        { value: 'IFRS', label: 'IFRS' },
    ] as const;
    const existingTypes = new Set(books.map(b => b.bookType));
    const availableTypes = ALL_BOOK_TYPES.filter(t => !existingTypes.has(t.value));

    if (viewMode === 'LEDGER') {
        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setViewMode('LIST')}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition flex items-center gap-2"
                    >
                        <ChevronLeft size={16} /> Back to Books
                    </button>
                    <h2 className="text-xl font-bold text-slate-800">Depreciation Ledger: {selectedBook?.bookType}</h2>
                </div>

                {selectedBook ? (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <Table size={18} className="text-slate-400" />
                                    Depreciation Ledger
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Projected posting schedule for <strong>{selectedBook.bookType}</strong> book using <strong>{selectedBook.depreciationMethod.replace(/_/g, ' ')}</strong>.
                                </p>
                            </div>
                            <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                Export CSV
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-3">Year</th>
                                        <th className="px-6 py-3">Period</th>
                                        <th className="px-6 py-3 text-right">Opening Value</th>
                                        <th className="px-6 py-3 text-right text-amber-600">Expense</th>
                                        <th className="px-6 py-3 text-right">Accumulated</th>
                                        <th className="px-6 py-3 text-right">Closing Value</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {schedule.map((item) => (
                                        <tr key={item.period} className="hover:bg-slate-50/80 transition group">
                                            <td className="px-6 py-3 font-mono text-slate-400">{item.period}</td>
                                            <td className="px-6 py-3 font-medium text-slate-700">{item.fiscalYear}</td>
                                            <td className="px-6 py-3 text-right font-mono text-slate-600">${(item.openingBookValue ?? 0).toLocaleString()}</td>
                                            <td className="px-6 py-3 text-right font-mono text-amber-600 font-medium">-${(item.depreciationExpense ?? 0).toLocaleString()}</td>
                                            <td className="px-6 py-3 text-right font-mono text-slate-400">${(item.accumulatedDepreciation ?? 0).toLocaleString()}</td>
                                            <td className="px-6 py-3 text-right font-mono font-bold text-slate-800 group-hover:text-blue-600 transition">
                                                ${(item.closingBookValue ?? 0).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                    {schedule.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-8 text-center text-slate-400 italic">
                                                Unable to calculate schedule. Check usage data or book configuration.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center p-12 bg-slate-50 rounded-xl border border-slate-200 border-dashed text-slate-400">
                        Select a depreciation book to view the ledger.
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Depreciation Books */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <BookOpen size={16} className="text-slate-400" />
                        Depreciation Books
                    </h3>
                    {financialRecord && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onReset}
                                className="text-xs bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 px-2 py-1 rounded flex items-center gap-1 font-medium"
                                title="Reset capitalization and remove all depreciation data"
                            >
                                <RotateCcw size={12} /> Reset
                            </button>
                            <button
                                onClick={() => setShowCapitalEventModal(true)}
                                className="text-xs bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-700 px-2 py-1 rounded flex items-center gap-1 font-medium"
                            >
                                <DollarSign size={12} /> Capital Event
                            </button>
                            <button
                                onClick={() => setShowAddBookModal(true)}
                                className="text-xs bg-white border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded flex items-center gap-1"
                            >
                                <Plus size={12} /> Add Book
                            </button>
                        </div>
                    )}
                </div>

                {!financialRecord ? (
                    <div className="p-6">
                        {!showCapitalizeForm ? (
                            <div className="text-center">
                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <BookOpen className="text-slate-400" size={20} />
                                </div>
                                <h4 className="text-sm font-bold text-slate-800 mb-1">Asset Not Capitalized</h4>
                                <p className="text-xs text-slate-500 mb-4 px-4">
                                    Record financial details to start tracking depreciation.
                                </p>
                                <button
                                    onClick={() => setShowCapitalizeForm(true)}
                                    className="px-4 py-2 bg-relantern-500 text-white text-xs rounded-lg font-medium hover:bg-relantern-600 transition shadow-sm inline-flex items-center gap-1.5"
                                >
                                    <DollarSign size={14} />
                                    Capitalize Asset
                                </button>
                            </div>
                        ) : (
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5">
                                    <DollarSign size={14} className="text-blue-600" />
                                    Capitalization Details
                                </h4>

                                <div className="space-y-3 mb-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Acquisition Cost ($)</label>
                                        <input type="number" value={capCost} onChange={e => setCapCost(parseFloat(e.target.value))} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Salvage ($)</label>
                                            <input type="number" value={capSalvage} onChange={e => setCapSalvage(parseFloat(e.target.value))} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs" />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Life (Years)</label>
                                            <input type="number" value={capLifeYears} onChange={e => setCapLifeYears(parseFloat(e.target.value))} className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs" />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setShowCapitalizeForm(false)} className="px-3 py-1.5 text-slate-600 hover:text-slate-800 font-medium text-xs">
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => { onCapitalize(capCost, capSalvage, capLifeYears, capDate); setShowCapitalizeForm(false); }}
                                        disabled={saving || capCost <= 0}
                                        className="px-3 py-1.5 bg-relantern-500 text-white rounded font-medium hover:bg-relantern-600 text-xs disabled:opacity-50"
                                    >
                                        {saving ? '...' : 'Confirm'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {books.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm italic">
                                No depreciation books. Click "Add Book" to create one.
                            </div>
                        ) : books.map(book => (
                            <div key={book.id} className="p-4 transition border-l-4 hover:bg-slate-50 border-transparent bg-white group">
                                <div className="flex justify-between items-start mb-1">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                        book.bookType === 'CORPORATE' ? 'bg-blue-100 text-blue-700' :
                                        book.bookType === 'TAX' ? 'bg-amber-100 text-amber-700' :
                                        book.bookType === 'IFRS' ? 'bg-purple-100 text-purple-700' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {book.bookType}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => onDeleteBook(book.id, book.bookType)} className="text-xs text-red-400 hover:text-red-600 transition-opacity p-0.5" title={`Delete ${book.bookType} book`}>
                                            <Trash2 size={13} />
                                        </button>
                                        <button onClick={() => handleViewLedger(book.id)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                                            Ledger <ChevronRight size={12} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-between items-end mt-2">
                                    <div>
                                        <div className="font-mono font-bold text-slate-700 text-lg">${(book.currentValue ?? 0).toLocaleString()}</div>
                                        <div className="text-xs text-slate-500">{book.depreciationMethod.replace(/_/g, ' ')}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-slate-400 mb-1">NBV %</div>
                                        <div className="w-24 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className="bg-blue-500 h-full"
                                                style={{ width: `${((book.currentValue ?? 0) / (financialRecord?.acquisitionCost || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Add Book Modal */}
            {showAddBookModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800">Add Depreciation Book</h3>
                            <button onClick={() => setShowAddBookModal(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Book Type</label>
                                {availableTypes.length === 0 ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-700">
                                        <AlertCircle size={14} className="inline mr-1" />
                                        All book types already exist. Delete an existing book first.
                                    </div>
                                ) : (
                                    <select
                                        value={availableTypes.some(t => t.value === newBookType) ? newBookType : availableTypes[0]?.value}
                                        onChange={e => setNewBookType(e.target.value as any)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                                    >
                                        {availableTypes.map(t => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                )}
                                {existingTypes.size > 0 && availableTypes.length > 0 && (
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        Existing: {Array.from(existingTypes).join(', ')}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Depreciation Method</label>
                                <select value={newBookMethod} onChange={e => setNewBookMethod(e.target.value as any)} className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white">
                                    <option value="STRAIGHT_LINE">Straight Line</option>
                                    <option value="DECLINING_BALANCE">Declining Balance</option>
                                    <option value="UNITS_OF_PRODUCTION">Units of Production</option>
                                    <option value="SUM_OF_YEARS_DIGITS">Sum of Years Digits</option>
                                </select>
                            </div>
                            <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700">
                                <p className="font-bold mb-1">Note:</p>
                                <p>New book will start with the asset's acquisition cost and date.</p>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                            <button onClick={() => setShowAddBookModal(false)} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm">Cancel</button>
                            <button
                                onClick={() => { onAddBook(newBookType, newBookMethod); setShowAddBookModal(false); }}
                                disabled={saving}
                                className="px-4 py-2 bg-relantern-500 text-white rounded-lg font-medium hover:bg-relantern-600 text-sm disabled:opacity-50"
                            >
                                {saving ? 'Adding...' : 'Create Book'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Capital Event Modal */}
            {financialRecord && (
                <CapitalEventModal
                    isOpen={showCapitalEventModal}
                    onClose={() => setShowCapitalEventModal(false)}
                    assetId={asset.id}
                    assetTag={asset.tag}
                    financialRecord={financialRecord}
                    onSuccess={(_result: RecapitalizationResult) => {
                        onReload();
                    }}
                />
            )}
        </div>
    );
};
