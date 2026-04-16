import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type { Category } from "@/types/database";

interface CategoryState {
  categories: Category[];
  isLoading: boolean;

  fetchCategories: () => Promise<void>;
  createCategory: (
    name: string,
    parentId: string | null,
    description?: string,
  ) => Promise<void>;
  getSubcategories: (parentId: string | null) => Category[];
  getCategoryPath: (id: string) => Category[];
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  isLoading: false,

  fetchCategories: async () => {
    set({ isLoading: true });

    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order")
      .order("name");

    if (error) {
      logError("category-store:fetchCategories", error.message);
      set({ isLoading: false });
      return;
    }

    set({ categories: (data ?? []) as Category[], isLoading: false });
  },

  createCategory: async (name, parentId, description) => {
    if (containsProfanity(name) || containsProfanity(description)) {
      throw new Error(
        "Category name or description contains disallowed language.",
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const { error } = await supabase.from("categories").insert({
      name,
      slug,
      parent_id: parentId,
      created_by: user?.id ?? null,
      description: description || null,
      sort_order: 0,
    });

    if (error) {
      logError("category-store:createCategory", error.message);
      throw error;
    }

    await get().fetchCategories();
  },

  getSubcategories: (parentId) => {
    return get().categories.filter((c) => c.parent_id === parentId);
  },

  getCategoryPath: (id) => {
    const { categories } = get();
    const path: Category[] = [];
    let current = categories.find((c) => c.id === id);
    while (current) {
      path.unshift(current);
      current = current.parent_id
        ? categories.find((c) => c.id === current!.parent_id)
        : undefined;
    }
    return path;
  },
}));
