SERVICE := fleet-bot.service
UNIT_DIR := /etc/systemd/system

.PHONY: build deploy restart stop logs clean

build:
	docker compose build

deploy: build
	cp $(SERVICE) $(UNIT_DIR)/$(SERVICE)
	systemctl daemon-reload
	systemctl enable $(SERVICE)
	systemctl restart $(SERVICE)
	@echo "Deployed. Check: systemctl status $(SERVICE)"

restart:
	systemctl restart $(SERVICE)

stop:
	systemctl stop $(SERVICE)

logs:
	docker logs -f fleet-bot

clean:
	docker compose down --rmi local
