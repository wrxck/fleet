package monitor

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/client"
)

const dockerTimeout = 10 * time.Second

// ContainerInfo holds one-shot container info with stats.
type ContainerInfo struct {
	ID      string
	Name    string
	Image   string
	State   string
	Status  string
	Health  string
	CPUPerc float64
	MemUsed uint64
	MemMax  uint64
	MemPerc float64
	NetRx   uint64
	NetTx   uint64
	PIDs    uint64
}

// GetContainers returns a snapshot of all containers with basic stats.
func GetContainers() ([]ContainerInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithVersion("1.44"))
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	containers, err := cli.ContainerList(ctx, types.ContainerListOptions{All: true})
	if err != nil {
		return nil, err
	}

	var result []ContainerInfo
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		info := ContainerInfo{
			ID:     c.ID[:12],
			Name:   name,
			Image:  c.Image,
			State:  c.State,
			Status: c.Status,
		}

		// Get health
		if c.State == "running" {
			inspected, err := cli.ContainerInspect(ctx, c.ID)
			if err == nil && inspected.State != nil && inspected.State.Health != nil {
				info.Health = inspected.State.Health.Status
			}

			// Get one-shot stats (stream=false)
			statsResp, err := cli.ContainerStatsOneShot(ctx, c.ID)
			if err == nil {
				var stats types.StatsJSON
				if err := json.NewDecoder(statsResp.Body).Decode(&stats); err == nil {
					info.CPUPerc = calcCPUPercent(&stats)
					info.MemUsed = stats.MemoryStats.Usage - stats.MemoryStats.Stats["cache"]
					info.MemMax = stats.MemoryStats.Limit
					if info.MemMax > 0 {
						info.MemPerc = float64(info.MemUsed) / float64(info.MemMax) * 100
					}
					for _, net := range stats.Networks {
						info.NetRx += net.RxBytes
						info.NetTx += net.TxBytes
					}
					info.PIDs = stats.PidsStats.Current
				}
				statsResp.Body.Close()
			}
		}

		result = append(result, info)
	}

	return result, nil
}

func calcCPUPercent(stats *types.StatsJSON) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	if systemDelta <= 0 || cpuDelta < 0 {
		return 0
	}
	numCPUs := float64(stats.CPUStats.OnlineCPUs)
	if numCPUs == 0 {
		numCPUs = float64(len(stats.CPUStats.CPUUsage.PercpuUsage))
	}
	if numCPUs == 0 {
		numCPUs = 1
	}
	return (cpuDelta / systemDelta) * numCPUs * 100.0
}
