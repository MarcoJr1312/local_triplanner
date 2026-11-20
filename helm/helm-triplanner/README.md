# helm-triplanner

Helm chart for the Triplanner demo email pipeline: a Go HTTP broker and the
email consumer with BYOK settings.

## Layout

```
templates/
  broker/
    broker-deployment.yaml
    broker-networkpolicy.yaml
    broker-pvc.yaml
    broker-service.yaml
  email/
    email-deployment.yaml
    email-hpa.yaml
    email-networkpolicy.yaml
    email-pvc.yaml
    email-service.yaml
    email-test.yaml
  NOTES.txt
  _helpers.tpl
  serviceaccount.yaml
values.yaml
```

Each microservice owns its folder and every file is prefixed with the service
name. `serviceaccount.yaml`, `_helpers.tpl` and `NOTES.txt` stay at the chart
level because they are shared.

## Install

First create the namespace; every manifest is rendered into it via
`.Release.Namespace` (or run Helm with `--create-namespace`):

```bash
kubectl create namespace triplanner
```

Prerequisites:

- A default StorageClass for the two PVCs.
- The `triplanner-internal` Secret with `INTERNAL_TOKEN`.
- Images published at `marcojr13/triplanner-kafka:0.1.0` and
  `marcojr13/triplanner-email:0.1.0` (or override `images.*`).

```bash
kubectl create namespace triplanner
kubectl -n triplanner create secret generic triplanner-internal \
  --from-literal=INTERNAL_TOKEN="$(openssl rand -hex 32)"

helm install triplanner ./helm/helm-triplanner \
  --namespace triplanner \
  --wait
```

The email service starts with `provider: sink`; the recruiter adds a Resend key
in **Profile → Email delivery**. No Resend Secret is required.

## Verify

```bash
helm test triplanner -n triplanner
kubectl -n triplanner get pods
kubectl -n triplanner port-forward svc/triplanner-email 4200:4200
curl http://localhost:4200/health
curl http://localhost:4200/ready
```

Test hook pods are deleted after success via
`helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded`. Failed tests
keep the pod for logs.

## Uninstall

```bash
helm uninstall triplanner -n triplanner
kubectl delete namespace triplanner
```
