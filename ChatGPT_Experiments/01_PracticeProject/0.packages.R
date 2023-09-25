w_dr <- getwd()
project_dr <- paste0(w_dr, "/ChatGPT_Experiments/01_PracticeProject/")

# List of packages you want to load
packages <- c("tidyverse", "fst")

# Use lapply to load each package
lapply(packages, library, character.only = TRUE)
