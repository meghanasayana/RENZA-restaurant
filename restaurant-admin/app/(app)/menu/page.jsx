'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plus, Pencil, Trash2, UtensilsCrossed, Search, Filter, Sparkles, FolderTree, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import MenuImportDialog from '@/components/MenuImportDialog';
import DishDescriptionsPanel from '@/components/DishDescriptionsPanel';
import MenuAssistantPanel from '@/components/MenuAssistantPanel';

const FILTERS = ['All', 'Available', 'Sold Out', 'Combos', 'Specials', 'Seasonal'];

const SEASONAL_KEYWORDS = ['season', 'summer', 'winter', 'monsoon', 'festive', 'mango', 'spring', 'holiday', 'autumn'];
const isSeasonalDish = (tag) => {
  if (!tag || typeof tag !== 'string') return false;
  const t = tag.trim().toLowerCase();
  if (['jain', 'vegan', 'gluten-free'].includes(t)) return false;
  return SEASONAL_KEYWORDS.some((kw) => t.includes(kw));
};
const isSpecialDish = (tag) => {
  if (!tag || typeof tag !== 'string') return false;
  const t = tag.trim().toLowerCase();
  if (['jain', 'vegan', 'gluten-free'].includes(t)) return false;
  return !isSeasonalDish(tag);
};

function FoodItemSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-3.5 sm:p-4 flex gap-3 sm:gap-4">
      <Skeleton className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center gap-2 mt-3 pt-2">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-7 rounded-lg ml-auto" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function parsePortionPrices(portionPrices) {
  if (!portionPrices) return null;
  try {
    const parsed = typeof portionPrices === 'string' ? JSON.parse(portionPrices) : portionPrices;
    if (parsed && typeof parsed === 'object') {
      const list = [];
      if (parsed.quarter !== undefined && parsed.quarter !== null && Number(parsed.quarter) > 0) {
        list.push({ label: 'Quarter', short: '1/4', price: Number(parsed.quarter) });
      }
      if (parsed.half !== undefined && parsed.half !== null && Number(parsed.half) > 0) {
        list.push({ label: 'Half', short: '1/2', price: Number(parsed.half) });
      }
      if (parsed.full !== undefined && parsed.full !== null && Number(parsed.full) > 0) {
        list.push({ label: 'Full', short: 'Full', price: Number(parsed.full) });
      }
      if (parsed.regular !== undefined && parsed.regular !== null && Number(parsed.regular) > 0) {
        list.push({ label: 'Regular', short: 'Regular', price: Number(parsed.regular) });
      }
      if (parsed.special !== undefined && parsed.special !== null && Number(parsed.special) > 0) {
        list.push({ label: 'Special', short: 'Special', price: Number(parsed.special) });
      }
      if (list.length > 0) return list;
    }
  } catch {}
  return null;
}

function parsePreparationPrices(preparationPrices) {
  if (!preparationPrices) return null;
  try {
    const parsed = typeof preparationPrices === 'string' ? JSON.parse(preparationPrices) : preparationPrices;
    if (parsed && typeof parsed === 'object') {
      const list = [];
      if (parsed.dry !== undefined && parsed.dry !== null && Number(parsed.dry) > 0) {
        list.push({ label: 'Dry', short: '🍗 Dry', price: Number(parsed.dry) });
      }
      if (parsed.gravy !== undefined && parsed.gravy !== null && Number(parsed.gravy) > 0) {
        list.push({ label: 'Gravy', short: '🍲 Gravy', price: Number(parsed.gravy) });
      }
      if (parsed.semiGravy !== undefined && parsed.semiGravy !== null && Number(parsed.semiGravy) > 0) {
        list.push({ label: 'Semi-Gravy', short: '🥘 Semi', price: Number(parsed.semiGravy) });
      }
      if (list.length > 0) return list;
    }
  } catch {}
  return null;
}

function FoodItemCard({ item, onToggle, onEdit, onDelete }) {
  const [toggling, setToggling] = useState(false);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const itemId = item.id || item._id;
  const portions = parsePortionPrices(item.portionPrices);
  const prepList = parsePreparationPrices(item.preparationPrices);

  const handleToggle = async () => {
    setToggling(true);
    const newState = !item.isAvailable;
    // Optimistic update
    onToggle(itemId, newState);
    try {
      await api.patch(`/api/restaurant/foods/${itemId}/availability`, {
        isAvailable: newState,
      });
      toast.success(newState ? `${item.name} marked Available` : `${item.name} marked Sold Out`);
    } catch (err) {
      // Revert on failure
      onToggle(itemId, !newState);
      toast.error('Failed to update dish availability');
    } finally {
      setToggling(false);
    }
  };

  const rawFrontImage = item.imageUrl || item.image;
  const rawTopImage = item.topViewImageUrl || item.top_view_image_url;
  const rawImage = rawFrontImage || rawTopImage;
  const imageUrl = rawImage
    ? rawImage.startsWith('http') ? rawImage : `${API_URL}${rawImage}`
    : null;
  const hasBothImages = Boolean(rawFrontImage && rawTopImage);

  const isVeg = item.isVeg === true || item.foodType === 'veg';
  const seasonal = isSeasonalDish(item.specialTags);

  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col justify-between",
      !item.isAvailable && "bg-slate-50/70 border-slate-200"
    )}>
      <div className="flex gap-3 sm:gap-4 p-3.5 sm:p-4">
        {/* Food Image */}
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-200/80 relative">
          {imageUrl ? (
            <>
              <Image
                src={imageUrl}
                alt={item.name}
                fill
                sizes="96px"
                className={cn("object-cover transition-opacity", !item.isAvailable && "opacity-60")}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {hasBothImages && (
                <span className="absolute bottom-1 right-1 z-10 text-[8px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-amber-300 backdrop-blur-xs">
                  2 Views
                </span>
              )}
              {!rawFrontImage && rawTopImage && (
                <span className="absolute bottom-1 right-1 z-10 text-[8px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white backdrop-blur-xs">
                  Top View
                </span>
              )}
              {item.specialTags && (
                <span className={cn(
                  "absolute top-1 left-1 z-10 text-[8px] font-black tracking-wide uppercase px-1.5 py-0.5 rounded shadow-xs backdrop-blur-xs",
                  seasonal
                    ? "bg-black/80 text-emerald-300 border border-emerald-400/40"
                    : "bg-black/80 text-amber-300 border border-amber-400/40"
                )}>
                  {seasonal ? `🍁 ${item.specialTags}` : item.specialTags}
                </span>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
              <UtensilsCrossed className="w-6 h-6 sm:w-7 sm:h-7" />
              <span className="text-[9px] text-slate-400 mt-1 font-medium">No photo</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 sm:gap-2 mb-1">
            {/* Veg/Non-veg FSSAI dot */}
            <span
              className={cn(
                'mt-1 w-3.5 h-3.5 rounded-sm border-2 flex-shrink-0 flex items-center justify-center',
                isVeg ? 'border-emerald-600' : 'border-rose-600'
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isVeg ? 'bg-emerald-600' : 'bg-rose-600'
                )}
              />
            </span>
            <h3 className={cn("font-bold text-slate-900 text-sm leading-snug truncate", !item.isAvailable && "text-slate-500")}>
              {item.name}
            </h3>
          </div>

          {prepList ? (
            <div className="space-y-1 mt-0.5 mb-1">
              <p className="text-slate-900 font-black text-sm sm:text-base">
                ₹{Math.min(...prepList.map((p) => p.price))}
                {Math.min(...prepList.map((p) => p.price)) !== Math.max(...prepList.map((p) => p.price)) &&
                  ` – ₹${Math.max(...prepList.map((p) => p.price))}`}
              </p>
              <div className="flex flex-wrap gap-1">
                {prepList.map((p) => (
                  <span
                    key={p.label}
                    className="inline-flex items-center text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80 px-1.5 py-0.5 rounded"
                  >
                    {p.short}: ₹{p.price}
                  </span>
                ))}
              </div>
            </div>
          ) : portions ? (
            <div className="space-y-1 mt-0.5 mb-1">
              <p className="text-slate-900 font-black text-sm sm:text-base">
                ₹{Math.min(...portions.map((p) => p.price))}
                {Math.min(...portions.map((p) => p.price)) !== Math.max(...portions.map((p) => p.price)) &&
                  ` – ₹${Math.max(...portions.map((p) => p.price))}`}
              </p>
              <div className="flex flex-wrap gap-1">
                {portions.map((p) => (
                  <span
                    key={p.label}
                    className="inline-flex items-center text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200/80 px-1.5 py-0.5 rounded"
                  >
                    {p.short}: ₹{p.price}
                  </span>
                ))}
              </div>
            </div>
          ) : Number(item.price) > 0 ? (
            <p className="text-slate-900 font-black text-sm sm:text-base">₹{item.price}</p>
          ) : (
            <p className="text-slate-400 font-medium text-xs">Price not set</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {item.isCombo && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-white px-2 py-0.5 rounded-full shadow-2xs bg-gradient-to-r from-purple-600 to-indigo-600">
                🍱 {item.comboLabel || 'Combo'}
              </span>
            )}
            {item.specialTags ? (
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-white px-2 py-0.5 rounded-full shadow-2xs",
                seasonal
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600"
                  : "bg-gradient-to-r from-amber-500 to-orange-500"
              )}>
                {seasonal ? `🍁 ${item.specialTags}` : `⭐ ${item.specialTags}`}
              </span>
            ) : !item.isCombo ? (
              <span className="inline-flex items-center text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                Regular
              </span>
            ) : null}
            {item.category?.name && (
              <span className="inline-block text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-full">
                {item.category.name}
              </span>
            )}
            {!prepList && item.preparationType === 'dry' && (
              <span className="inline-flex items-center text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-md">
                🍗 Dry
              </span>
            )}
            {!prepList && item.preparationType === 'gravy' && (
              <span className="inline-flex items-center text-[10px] font-bold bg-orange-50 text-orange-800 border border-orange-200 px-1.5 py-0.5 rounded-md">
                🍲 Gravy
              </span>
            )}
            {!prepList && item.preparationType === 'semi-gravy' && (
              <span className="inline-flex items-center text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.5 rounded-md">
                🥘 Semi-Gravy
              </span>
            )}
            {!prepList && item.preparationType === 'both' && (
              <span className="inline-flex items-center text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded-md">
                🔄 Dry &amp; Gravy
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
              {item.description}
            </p>
          )}

          {item.isCombo && (() => {
            let parsed = [];
            try {
              parsed = typeof item.comboItems === 'string' ? JSON.parse(item.comboItems) : (item.comboItems || []);
            } catch {}
            if (Array.isArray(parsed) && parsed.length > 0) {
              return (
                <div className="flex flex-wrap items-center gap-1 mt-1.5 text-[11px] text-purple-900 font-semibold bg-purple-50/80 border border-purple-200/70 rounded-lg px-2 py-1">
                  <span className="text-[10px] font-bold text-purple-700 uppercase">Bundled:</span>
                  {parsed.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-purple-200/80 text-[10px]">
                      {c.quantity && <span className="font-bold text-purple-700">{c.quantity}</span>}
                      <span>{c.name}</span>
                    </span>
                  ))}
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* Bottom bar: Availability Toggle + Actions */}
      <div className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between gap-2">
        {/* Availability Toggle */}
        <div className="flex items-center gap-2">
          <Switch
            checked={item.isAvailable}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />
          <span className={cn(
            'text-[11px] sm:text-xs font-bold tracking-wide uppercase',
            item.isAvailable ? 'text-emerald-700' : 'text-rose-600'
          )}>
            {item.isAvailable ? 'Available' : 'Sold Out'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onEdit(itemId)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-orange-600 hover:border-orange-300 transition-colors shadow-2xs"
            title="Edit dish"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(item)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-rose-600 hover:border-rose-300 transition-colors shadow-2xs"
            title="Delete dish"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MenuPage() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchItems = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/restaurant/foods'),
      api.get('/api/restaurant/categories').catch(() => ({ data: { categories: [] } })),
    ])
      .then(([foodsRes, catsRes]) => {
        const foods = foodsRes.data?.foods || foodsRes.data || [];
        const cats = catsRes.data?.categories || catsRes.data || [];
        setItems(Array.isArray(foods) ? foods : []);
        setCategories(Array.isArray(cats) ? cats : []);
      })
      .catch((err) => {
        if (err.response?.status !== 401) toast.error('Failed to load menu dishes');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleToggleAvailability = (id, newState) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id || item._id === id) ? { ...item, isAvailable: newState } : item)
    );
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id || deleteTarget._id;
    setDeleting(true);
    try {
      await api.delete(`/api/restaurant/foods/${targetId}`);
      setItems((prev) => prev.filter((i) => (i.id !== targetId && i._id !== targetId)));
      toast.success(`"${deleteTarget.name}" deleted from menu`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error('Failed to delete dish');
    } finally {
      setDeleting(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesFilter =
        filter === 'All'
          ? true
          : filter === 'Available'
          ? item.isAvailable
          : filter === 'Sold Out'
          ? !item.isAvailable
          : filter === 'Combos'
          ? Boolean(item.isCombo)
          : filter === 'Specials'
          ? isSpecialDish(item.specialTags)
          : filter === 'Seasonal'
          ? isSeasonalDish(item.specialTags)
          : true;

      const matchesCategory =
        selectedCategory === 'all'
          ? true
          : (item.categoryId === selectedCategory || item.category?.id === selectedCategory);

      const matchesSearch = search
        ? item.name?.toLowerCase().includes(search.toLowerCase()) ||
          item.category?.name?.toLowerCase().includes(search.toLowerCase()) ||
          item.description?.toLowerCase().includes(search.toLowerCase())
        : true;

      return matchesFilter && matchesCategory && matchesSearch;
    });
  }, [items, filter, selectedCategory, search]);

  const groupedSections = useMemo(() => {
    if (!groupByCategory || selectedCategory !== 'all') return [];

    const sections = [];
    const seenDishIds = new Set();
    const sortedCats = [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    sortedCats.forEach((cat) => {
      const catItems = filteredItems.filter((item) => {
        const matches = item.categoryId === cat.id || item.category?.id === cat.id;
        if (matches) seenDishIds.add(item.id || item._id);
        return matches;
      });

      if (catItems.length > 0) {
        sections.push({
          id: cat.id,
          name: cat.name,
          items: catItems,
        });
      }
    });

    const uncategorized = filteredItems.filter((item) => !seenDishIds.has(item.id || item._id));
    if (uncategorized.length > 0) {
      sections.push({
        id: 'uncategorized',
        name: 'Other Dishes',
        items: uncategorized,
      });
    }

    return sections;
  }, [categories, filteredItems, groupByCategory, selectedCategory]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">

      {/* AI menu tools: import a menu, write descriptions, change by typing. */}
      <div className="space-y-3">
        <MenuImportDialog onImported={fetchItems} />
        <DishDescriptionsPanel onChanged={fetchItems} />
        <MenuAssistantPanel onChanged={fetchItems} />
      </div>
      {/* ── HEADER & TOOLBAR ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Menu Dishes & Stock</h2>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
            {filteredItems.length !== items.length ? `Showing ${filteredItems.length} of ${items.length} dishes • ` : `Total ${items.length} dishes • `}
            {items.filter((i) => i.isAvailable).length} Available •{' '}
            {items.filter((i) => !i.isAvailable).length} Sold Out •{' '}
            {items.filter((i) => isSpecialDish(i.specialTags)).length} Specials •{' '}
            {items.filter((i) => isSeasonalDish(i.specialTags)).length} Seasonal
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button
            onClick={() => router.push('/menu/new')}
            className="w-full sm:w-auto justify-center bg-gradient-to-r from-orange-500 to-teal-600 hover:from-orange-600 hover:to-teal-700 text-white font-bold gap-2 shadow-sm rounded-xl px-4 py-2.5 h-auto text-xs"
          >
            <Plus className="w-4 h-4" />
            Add New Dish
          </Button>
        </div>
      </div>

      {/* ── SEARCH & FILTER CONTROLS ── */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row items-center gap-2.5 sm:gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes by name, category, or ingredients..."
              className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-xs"
            />
          </div>

          {/* View Mode Switcher: By Category vs All Grid */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-xs w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setGroupByCategory(true)}
              className={cn(
                'flex-1 sm:flex-none flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all',
                groupByCategory && selectedCategory === 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              )}
              title="Group dishes by category sections"
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>By Category</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupByCategory(false)}
              className={cn(
                'flex-1 sm:flex-none flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all',
                !groupByCategory || selectedCategory !== 'all'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              )}
              title="Show all dishes in single grid"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>All Grid</span>
            </button>
          </div>

          {/* Availability Status Filter Pills */}
          <div className="flex gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-xs w-full sm:w-auto">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 sm:flex-none py-1.5 px-3 sm:px-3.5 rounded-lg text-xs font-bold transition-all text-center',
                  filter === f
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* ── CATEGORY PILLS RAIL ── */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide -webkit-overflow-scrolling-touch">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-bold transition-all',
              selectedCategory === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            )}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>All Categories</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.2 rounded-full font-extrabold',
                selectedCategory === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
              )}
            >
              {items.length}
            </span>
          </button>

          {categories.map((cat) => {
            const count = items.filter(
              (i) => i.categoryId === cat.id || i.category?.id === cat.id
            ).length;
            const isSelected = selectedCategory === cat.id;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  'flex-shrink-0 inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-bold transition-all',
                  isSelected
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
                )}
              >
                <span>{cat.name}</span>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.2 rounded-full font-extrabold',
                    isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── FOOD ITEMS DISPLAY: CATEGORIZED SECTIONS OR FLAT GRID ── */}
      <div>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <FoodItemSkeleton key={i} />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mb-4">
              <UtensilsCrossed className="w-8 h-8 text-orange-400" />
            </div>
            <h3 className="font-bold text-slate-800 text-base mb-1">
              {search
                ? 'No matching dishes found'
                : selectedCategory !== 'all'
                ? 'No dishes in this category'
                : filter === 'All'
                ? 'No food items in menu yet'
                : `No ${filter.toLowerCase()} dishes`}
            </h3>
            <p className="text-slate-400 text-xs max-w-sm mb-6 leading-relaxed">
              {search || selectedCategory !== 'all' || filter !== 'All'
                ? 'Try resetting your search, category selection, or filters.'
                : 'Start showcasing your food to diners by adding your signature recipes.'}
            </p>
            <Button
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
                setFilter('All');
              }}
              className="gap-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold"
            >
              Reset Filters
            </Button>
          </div>
        ) : groupByCategory && selectedCategory === 'all' && groupedSections.length > 0 ? (
          /* Grouped by Category View */
          <div className="space-y-8">
            {groupedSections.map((group) => (
              <section key={group.id} className="space-y-3.5">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-200/80">
                  <h3 className="font-bold text-slate-900 text-base sm:text-lg tracking-tight">
                    {group.name}
                  </h3>
                  <span className="text-[11px] font-bold text-orange-600 bg-orange-50 border border-orange-200/60 px-2 py-0.5 rounded-full">
                    {group.items.length} {group.items.length === 1 ? 'dish' : 'dishes'}
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-r from-slate-200/80 via-slate-100 to-transparent" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {group.items.map((item) => (
                    <FoodItemCard
                      key={item.id || item._id}
                      item={item}
                      onToggle={handleToggleAvailability}
                      onEdit={(id) => router.push(`/menu/${id}/edit`)}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          /* Flat Grid View / Single Category Filtered View */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <FoodItemCard
                key={item.id || item._id}
                item={item}
                onToggle={handleToggleAvailability}
                onEdit={(id) => router.push(`/menu/${id}/edit`)}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md p-6 bg-white rounded-2xl border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Delete &quot;{deleteTarget?.name}&quot;?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 leading-relaxed mt-1">
              This action cannot be undone. This food item will be permanently removed from your digital menu and table QR display.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-xl text-xs font-bold"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
            >
              {deleting ? 'Deleting...' : 'Delete Dish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
