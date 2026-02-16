-- E-Commerce Domain
-- Demonstrates: interfaces, inheritance, type aliases, edge constraints,
-- cardinality, edge attributes, methods (node + edge).

extend "https://kernel.astrale.ai/v1" { Identity }

-- ─── Type Aliases ────────────────────────────────────────────

type Currency = String [in: ["USD", "EUR", "GBP", "JPY"]]
type OrderStatus = String [in: ["pending", "confirmed", "shipped", "delivered", "cancelled"]]
type SKU = String [length: 3..20]
type Email = String [format: email]
type Url = String [format: url]


-- ─── Interfaces ──────────────────────────────────────────────

interface Timestamped {
  createdAt: Timestamp = now(),
  updatedAt: Timestamp?
}

interface HasSlug {
  slug: String [unique]
}

interface Priceable {
  priceCents: Int,
  currency: Currency = "USD"
}

-- ─── Nodes ───────────────────────────────────────────────────

class Customer: Identity, Timestamped {
  email: Email [unique],
  name: String,
  phone: String?,

  fn displayName(): String,
  fn recentOrders(limit: Int = 10): Order[]
}

class Product: Timestamped, HasSlug, Priceable {
  title: String,
  description: String?,
  sku: SKU [unique],
  inStock: Boolean = true,
  imageUrl: Url?
}

class Category: HasSlug {
  name: String [unique]
}

class Order: Timestamped {
  status: OrderStatus = "pending",
  totalCents: Int,
  notes: String?,

  fn cancel(): Boolean
}

class Review: Timestamped {
  rating: Int,
  body: String?
}

-- ─── Edges ───────────────────────────────────────────────────

class placedOrder(customer: Customer, order: Order) [order -> 1, unique]

class orderItem(order: Order, product: Product) [] {
  quantity: Int = 1,
  unitPriceCents: Int,

  fn subtotal(): Int
}

class inCategory(product: Product, category: Category) []

class parentCategory(child: Category, parent: Category) [
  no_self,
  acyclic,
  child -> 0..1
]

class reviewed(reviewer: Customer, product: Product) [unique] {
  rating: Int,
  body: String?,
  verified: Boolean = false
}

class wishlisted(customer: Customer, product: Product) [unique]
