import { and, count, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCategoryBody,
  CreateCategoryParams,
  CreateCategoryResponse,
  CreateProductBody,
  CreateProductParams,
  CreateProductResponse,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  DeleteProductParams,
  DeleteProductResponse,
  ListCategoriesQueryParams,
  ListCategoriesResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import {
  categoriesTable,
  db,
  productsTable,
  storesTable,
} from "@workspace/db";
import { requireAuth, requireCsrf, getOwnedStore } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import { createId } from "../lib/security";

const router: IRouter = Router();
const PAGE_SIZES = new Set([10, 25, 50, 100]);

async function ownedCategory(categoryId: string, ownerId: string) {
  const [category] = await db
    .select({
      id: categoriesTable.id,
      storeId: categoriesTable.storeId,
      name: categoriesTable.name,
      description: categoriesTable.description,
      isDeleted: categoriesTable.isDeleted,
    })
    .from(categoriesTable)
    .innerJoin(storesTable, eq(storesTable.id, categoriesTable.storeId))
    .where(
      and(
        eq(categoriesTable.id, categoryId),
        eq(categoriesTable.isDeleted, false),
        eq(storesTable.ownerId, ownerId),
        eq(storesTable.isDeleted, false),
      ),
    )
    .limit(1);
  return category;
}

async function ownedProduct(productId: string, ownerId: string) {
  const [product] = await db
    .select({
      id: productsTable.id,
      storeId: productsTable.storeId,
      categoryId: productsTable.categoryId,
      sku: productsTable.sku,
      name: productsTable.name,
      description: productsTable.description,
      price: productsTable.price,
      stock: productsTable.stock,
      imageUrl: productsTable.imageUrl,
      isPublished: productsTable.isPublished,
    })
    .from(productsTable)
    .innerJoin(storesTable, eq(storesTable.id, productsTable.storeId))
    .where(
      and(
        eq(productsTable.id, productId),
        eq(productsTable.isDeleted, false),
        eq(storesTable.ownerId, ownerId),
        eq(storesTable.isDeleted, false),
      ),
    )
    .limit(1);
  return product;
}

async function getCategoryName(categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const [category] = await db
    .select({ name: categoriesTable.name })
    .from(categoriesTable)
    .where(
      and(
        eq(categoriesTable.id, categoryId),
        eq(categoriesTable.isDeleted, false),
      ),
    )
    .limit(1);
  return category?.name ?? null;
}

function publicProduct(
  product: typeof productsTable.$inferSelect,
  categoryName: string | null,
) {
  return {
    ...product,
    price: Number(product.price),
    categoryName,
  };
}

router.get("/categories", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListCategoriesQueryParams.safeParse({
    ...req.query,
    ...(req.query.pageSize !== undefined
      ? { pageSize: Number(req.query.pageSize) }
      : {}),
  });
  if (!parsed.success || !PAGE_SIZES.has(parsed.data.pageSize)) {
    res.status(400).json({ error: "خيارات الصفحات غير صالحة." });
    return;
  }
  const store = await getOwnedStore(parsed.data.storeId, req.auth!.userId);
  if (!store) {
    res.status(404).json({ error: "لم يتم العثور على المتجر." });
    return;
  }
  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: categoriesTable.id,
        storeId: categoriesTable.storeId,
        name: categoriesTable.name,
        description: categoriesTable.description,
        createdAt: categoriesTable.createdAt,
        productCount: count(productsTable.id),
      })
      .from(categoriesTable)
      .leftJoin(
        productsTable,
        and(
          eq(productsTable.categoryId, categoriesTable.id),
          eq(productsTable.isDeleted, false),
        ),
      )
      .where(
        and(
          eq(categoriesTable.storeId, store.id),
          eq(categoriesTable.isDeleted, false),
        ),
      )
      .groupBy(categoriesTable.id)
      .orderBy(categoriesTable.createdAt)
      .limit(parsed.data.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(categoriesTable)
      .where(
        and(
          eq(categoriesTable.storeId, store.id),
          eq(categoriesTable.isDeleted, false),
        ),
      ),
  ]);
  const response = {
    items: rows.map((row) => ({ ...row, productCount: Number(row.productCount) })),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
  res.json(ListCategoriesResponse.parse(response));
});

router.post(
  "/stores/:storeId/categories",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = CreateCategoryParams.safeParse(req.params);
    const parsed = CreateCategoryBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.name.trim()) {
      res.status(400).json({ error: "تحقق من بيانات التصنيف." });
      return;
    }
    const store = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const id = createId();
    const [category] = await db
      .insert(categoriesTable)
      .values({
        id,
        storeId: store.id,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
      })
      .returning();
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: store.id,
      action: "category.created",
      summary: `تم إنشاء التصنيف ${category.name}`,
    });
    res.status(201).json(
      CreateCategoryResponse.parse({ ...category, productCount: 0 }),
    );
  },
);

router.patch(
  "/categories/:categoryId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateCategoryParams.safeParse(req.params);
    const parsed = UpdateCategoryBody.safeParse(req.body);
    if (
      !params.success ||
      !parsed.success ||
      (parsed.data.name !== undefined && !parsed.data.name.trim())
    ) {
      res.status(400).json({ error: "تحقق من بيانات التصنيف." });
      return;
    }
    const category = await ownedCategory(params.data.categoryId, req.auth!.userId);
    if (!category) {
      res.status(404).json({ error: "لم يتم العثور على التصنيف." });
      return;
    }
    const updates: Partial<typeof categoriesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) {
      updates.description = parsed.data.description.trim() || null;
    }
    const [updated] = await db
      .update(categoriesTable)
      .set(updates)
      .where(
        and(
          eq(categoriesTable.id, category.id),
          eq(categoriesTable.storeId, category.storeId),
          eq(categoriesTable.isDeleted, false),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "لم يتم العثور على التصنيف." });
      return;
    }
    const [{ value }] = await db
      .select({ value: count() })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.categoryId, category.id),
          eq(productsTable.isDeleted, false),
        ),
      );
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: category.storeId,
      action: "category.updated",
      summary: `تم تحديث التصنيف ${updated.name}`,
    });
    res.json(
      UpdateCategoryResponse.parse({
        ...updated,
        productCount: Number(value ?? 0),
      }),
    );
  },
);

router.delete(
  "/categories/:categoryId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = DeleteCategoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف التصنيف غير صالح." });
      return;
    }
    const category = await ownedCategory(params.data.categoryId, req.auth!.userId);
    if (!category) {
      res.status(404).json({ error: "لم يتم العثور على التصنيف." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(productsTable)
        .set({ categoryId: null, updatedAt: new Date() })
        .where(
          and(
            eq(productsTable.categoryId, category.id),
            eq(productsTable.storeId, category.storeId),
            eq(productsTable.isDeleted, false),
          ),
        );
      await tx
        .update(categoriesTable)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(
          and(
            eq(categoriesTable.id, category.id),
            eq(categoriesTable.storeId, category.storeId),
          ),
        );
    });
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: category.storeId,
      action: "category.archived",
      summary: `تم أرشفة التصنيف ${category.name}`,
    });
    res.json(DeleteCategoryResponse.parse({ success: true }));
  },
);

router.get("/products", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse({
    ...req.query,
    ...(req.query.pageSize !== undefined
      ? { pageSize: Number(req.query.pageSize) }
      : {}),
  });
  if (!parsed.success || !PAGE_SIZES.has(parsed.data.pageSize)) {
    res.status(400).json({ error: "خيارات الصفحات غير صالحة." });
    return;
  }
  const store = await getOwnedStore(parsed.data.storeId, req.auth!.userId);
  if (!store) {
    res.status(404).json({ error: "لم يتم العثور على المتجر." });
    return;
  }

  const filters = [
    eq(productsTable.storeId, store.id),
    eq(productsTable.isDeleted, false),
  ];
  if (parsed.data.search?.trim()) {
    const search = `%${parsed.data.search.trim().replace(/[%_]/g, "\\$&")}%`;
    filters.push(
      or(
        ilike(productsTable.name, search),
        ilike(productsTable.description, search),
        ilike(productsTable.sku, search),
      )!,
    );
  }
  if (parsed.data.categoryId) {
    filters.push(eq(productsTable.categoryId, parsed.data.categoryId));
  }

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({ product: productsTable, categoryName: categoriesTable.name })
      .from(productsTable)
      .leftJoin(
        categoriesTable,
        and(
          eq(categoriesTable.id, productsTable.categoryId),
          eq(categoriesTable.isDeleted, false),
        ),
      )
      .where(and(...filters))
      .orderBy(productsTable.createdAt)
      .limit(parsed.data.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(productsTable)
      .where(and(...filters)),
  ]);
  res.json(
    ListProductsResponse.parse({
      items: rows.map(({ product, categoryName }) =>
        publicProduct(product, categoryName),
      ),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: Number(totalRow?.value ?? 0),
    }),
  );
});

router.post(
  "/stores/:storeId/products",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = CreateProductParams.safeParse(req.params);
    const parsed = CreateProductBody.safeParse(req.body);
    if (!params.success || !parsed.success || !parsed.data.name.trim()) {
      res.status(400).json({ error: "تحقق من بيانات المنتج." });
      return;
    }
    const store = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const categoryId = parsed.data.categoryId ?? null;
    if (categoryId) {
      const [category] = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.id, categoryId),
            eq(categoriesTable.storeId, store.id),
            eq(categoriesTable.isDeleted, false),
          ),
        )
        .limit(1);
      if (!category) {
        res.status(400).json({ error: "التصنيف غير موجود في هذا المتجر." });
        return;
      }
    }

    try {
      const [product] = await db
        .insert(productsTable)
        .values({
          id: createId(),
          storeId: store.id,
          categoryId,
          sku: parsed.data.sku?.trim() || null,
          name: parsed.data.name.trim(),
          description: parsed.data.description.trim(),
          price: parsed.data.price.toFixed(2),
          stock: parsed.data.stock,
          imageUrl: parsed.data.imageUrl ?? null,
          isPublished: parsed.data.isPublished,
        })
        .returning();
      await writeAuditEvent({
        userId: req.auth!.userId,
        storeId: store.id,
        action: "product.created",
        summary: `تم إنشاء المنتج ${product.name}`,
      });
      res.status(201).json(
        CreateProductResponse.parse({
          ...publicProduct(product, await getCategoryName(product.categoryId)),
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "رمز SKU مستخدم بالفعل في هذا المتجر." });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/products/:productId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateProductParams.safeParse(req.params);
    const parsed = UpdateProductBody.safeParse(req.body);
    if (
      !params.success ||
      !parsed.success ||
      (parsed.data.name !== undefined && !parsed.data.name.trim())
    ) {
      res.status(400).json({ error: "تحقق من بيانات المنتج." });
      return;
    }
    const product = await ownedProduct(params.data.productId, req.auth!.userId);
    if (!product) {
      res.status(404).json({ error: "لم يتم العثور على المنتج." });
      return;
    }
    if (parsed.data.categoryId) {
      const [category] = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.id, parsed.data.categoryId),
            eq(categoriesTable.storeId, product.storeId),
            eq(categoriesTable.isDeleted, false),
          ),
        )
        .limit(1);
      if (!category) {
        res.status(400).json({ error: "التصنيف غير موجود في هذا المتجر." });
        return;
      }
    }

    const updates: Partial<typeof productsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) {
      updates.description = parsed.data.description.trim();
    }
    if (parsed.data.price !== undefined) {
      updates.price = parsed.data.price.toFixed(2);
    }
    if (parsed.data.stock !== undefined) updates.stock = parsed.data.stock;
    if (parsed.data.categoryId !== undefined) {
      updates.categoryId = parsed.data.categoryId;
    }
    if (parsed.data.sku !== undefined) {
      updates.sku = parsed.data.sku?.trim() || null;
    }
    if (parsed.data.imageUrl !== undefined) updates.imageUrl = parsed.data.imageUrl;
    if (parsed.data.isPublished !== undefined) {
      updates.isPublished = parsed.data.isPublished;
    }

    try {
      const [updated] = await db
        .update(productsTable)
        .set(updates)
        .where(
          and(
            eq(productsTable.id, product.id),
            eq(productsTable.storeId, product.storeId),
            eq(productsTable.isDeleted, false),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "لم يتم العثور على المنتج." });
        return;
      }
      await writeAuditEvent({
        userId: req.auth!.userId,
        storeId: product.storeId,
        action: "product.updated",
        summary: `تم تحديث المنتج ${updated.name}`,
      });
      res.json(
        UpdateProductResponse.parse({
          ...publicProduct(updated, await getCategoryName(updated.categoryId)),
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "رمز SKU مستخدم بالفعل في هذا المتجر." });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/products/:productId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = DeleteProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف المنتج غير صالح." });
      return;
    }
    const product = await ownedProduct(params.data.productId, req.auth!.userId);
    if (!product) {
      res.status(404).json({ error: "لم يتم العثور على المنتج." });
      return;
    }
    await db
      .update(productsTable)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(productsTable.id, product.id),
          eq(productsTable.storeId, product.storeId),
        ),
      );
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: product.storeId,
      action: "product.archived",
      summary: `تم أرشفة المنتج ${product.name}`,
    });
    res.json(DeleteProductResponse.parse({ success: true }));
  },
);

export default router;
