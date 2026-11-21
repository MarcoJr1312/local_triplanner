{{/*
Expand the name of the chart.
*/}}
{{- define "helm-triplanner.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "helm-triplanner.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "helm-triplanner.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "helm-triplanner.labels" -}}
helm.sh/chart: {{ include "helm-triplanner.chart" . }}
{{ include "helm-triplanner.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "helm-triplanner.selectorLabels" -}}
app.kubernetes.io/name: {{ include "helm-triplanner.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Broker and email service accounts. Each service owns its identity; neither
needs Kubernetes API permissions in the current design.
*/}}
{{- define "helm-triplanner.brokerServiceAccountName" -}}
{{- default (printf "%s-broker" (include "helm-triplanner.fullname" .)) .Values.broker.serviceAccount.name }}
{{- end }}

{{- define "helm-triplanner.emailServiceAccountName" -}}
{{- default (printf "%s-email" (include "helm-triplanner.fullname" .)) .Values.emailService.serviceAccount.name }}
{{- end }}
