import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { api, ApiError, type Me } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { Loading } from "./components/ui.tsx";
import { setCurrency } from "./format.ts";
import { AuthPage } from "./pages/Auth.tsx";
import { CustomerDetailPage, CustomersPage } from "./pages/Customers.tsx";
import { DashboardPage } from "./pages/Dashboard.tsx";
import { BoardPage, FloorPage } from "./pages/Floor.tsx";
import { OperatorPage } from "./pages/Operator.tsx";
import { ItemEditorPage, ItemsPage } from "./pages/Items.tsx";
import { JobDetailPage, JobsPage } from "./pages/Jobs.tsx";
import { QuoteEditorPage, QuotesPage } from "./pages/Quotes.tsx";
import { SalesOrderPage, SalesOrdersPage } from "./pages/SalesOrders.tsx";
import { ComingSoonPage, NotFoundPage } from "./pages/Soon.tsx";
import { InventoryPage, ItemStockPage, StockTakePage } from "./pages/Inventory.tsx";
import { PurchaseOrderPage, PurchasingPage, VendorPage } from "./pages/Purchasing.tsx";
import { PackagingPage } from "./pages/Packaging.tsx";
import { QualityPage } from "./pages/Quality.tsx";
import { ReportEditorPage, ReportsPage } from "./pages/Reports.tsx";
import { WorkCentersPage } from "./pages/WorkCenters.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // No silent refetch on tab focus: it would reset forms that hold unsaved edits.
    queries: { refetchOnWindowFocus: false, retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2, staleTime: 15_000 },
  },
});

function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/auth/me").catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: Infinity,
  });
  if (me.isLoading) return <Loading />;
  if (!me.data) return <AuthPage />;
  setCurrency(me.data.org.currency);
  return (
    <Shell me={me.data}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/new" element={<QuoteEditorPage />} />
        <Route path="/quotes/:id" element={<QuoteEditorPage />} />
        <Route path="/sales-orders" element={<SalesOrdersPage />} />
        <Route path="/sales-orders/:id" element={<SalesOrderPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/floor" element={<FloorPage />} />
        <Route path="/floor/op/:id" element={<OperatorPage />} />
        <Route path="/floor/board" element={<BoardPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/new" element={<ItemEditorPage />} />
        <Route path="/items/:id" element={<ItemEditorPage />} />
        <Route path="/work-centers" element={<WorkCentersPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/purchasing" element={<PurchasingPage />} />
        <Route path="/packaging" element={<PackagingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:id" element={<ReportEditorPage />} />
        <Route path="/purchasing/orders/:id" element={<PurchaseOrderPage />} />
        <Route path="/purchasing/vendors/:id" element={<VendorPage />} />
        <Route path="/inventory/stock-take" element={<StockTakePage />} />
        <Route path="/inventory/:id" element={<ItemStockPage />} />
        <Route path="/soon/:module" element={<ComingSoonPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
