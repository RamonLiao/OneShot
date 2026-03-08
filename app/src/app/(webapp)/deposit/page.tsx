import DepositForm from "@/components/web/DepositForm";

export default function DepositPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Deposit USDC</h1>
      <p className="text-gray-400 text-sm mb-8">
        Deposit USDC into a Vault on any supported chain. Funds are linked to your hashed user ID
        for anonymous betting.
      </p>
      <DepositForm />
    </div>
  );
}
